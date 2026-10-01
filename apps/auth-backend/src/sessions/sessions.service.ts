import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  createEvent,
  deviceOf,
  identitySessionRevoked,
  notificationRequested,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { RolesService } from "../access/roles.service.js";
import type { ClientContext } from "../common/client-context.js";
import type { AuthDatabase, AuthTx } from "../common/database.js";
import { tokenConfig } from "../config/config.js";
import { sessions, users } from "../db/schema.js";
import { SigningKeys } from "../keys/signing-keys.service.js";
import { RefreshStore } from "./refresh-store.js";

type RevokeReason = "logout" | "user" | "admin" | "reuse_detected" | "expired";

export type SessionTokens = {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

@Injectable()
export class SessionsService {
  private readonly logger = new Logger("Sessions");

  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(tokenConfig.KEY)
    private readonly config: ConfigType<typeof tokenConfig>,
    private readonly refresh: RefreshStore,
    private readonly keys: SigningKeys,
    private readonly roles: RolesService,
    private readonly relay: OutboxRelay,
  ) {}

  /** Creates the session row inside the caller's transaction; tokens after commit. */
  async create(
    tx: AuthTx,
    userId: string,
    method: "email" | "google" | "passkey" | "sso",
    client: ClientContext,
    clientId: string | null = null,
  ) {
    const now = this.clock.now();
    const [session] = await tx
      .insert(sessions)
      .values({
        userId,
        authMethod: method,
        clientId,
        userAgent: client.userAgent,
        ip: client.ip,
        createdAt: now,
        lastActiveAt: now,
      })
      .returning({ id: sessions.id });
    if (!session) throw new Error("session insert failed");
    return session.id;
  }

  /**
   * Tells the account owner about a sign-in no email preceded: a passkey or
   * Google (`security.sign-in.v1`), in the transaction of the session. An
   * email code is a message of its own, and an app session through SSO
   * rides on a sign-in that was already told. Only the method, the time and
   * a browser and a system from a fixed list travel (deviceOf): the
   * User-Agent itself is whatever the client sent.
   */
  async announceSignIn(
    tx: AuthTx,
    userId: string,
    sessionId: string,
    method: "passkey" | "google",
    client: ClientContext,
  ) {
    const now = this.clock.now();
    await enqueueEvent(
      tx,
      createEvent(notificationRequested, {
        producer: "identity",
        aggregateId: userId,
        aggregateVersion: 1,
        occurredAt: now,
        payload: {
          sourceEventId: sessionId,
          templateKey: "security.sign-in.v1",
          category: "security",
          recipient: { userId },
          data: {
            at: now.toISOString(),
            method,
            ...deviceOf(client.userAgent),
          },
        },
      }),
    );
  }

  /** Issues the first token pair of a committed session. */
  async issue(sessionId: string, userId: string): Promise<SessionTokens> {
    const refreshToken = await this.refresh.issue(
      sessionId,
      this.config.refreshTtlSec,
    );
    return this.tokens(sessionId, userId, refreshToken);
  }

  /**
   * Rotates a refresh token. A legitimate concurrent or repeated call gets
   * the same new token; reuse outside the grace window burns the session.
   */
  async rotate(
    presented: string,
    client: ClientContext,
  ): Promise<SessionTokens> {
    const outcome = await this.refresh.rotate(presented, {
      ttlSec: this.config.refreshTtlSec,
      graceMs: this.config.refreshGraceMs,
    });
    if (outcome.result === "REUSE" && outcome.sessionId) {
      await this.onReuse(outcome.sessionId, client);
      throw new AppError("UNAUTHENTICATED");
    }
    if (outcome.result !== "OK" && outcome.result !== "RETRY") {
      throw new AppError("UNAUTHENTICATED");
    }
    const [session] = await this.database.db
      .select({
        userId: sessions.userId,
        revokedAt: sessions.revokedAt,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, outcome.sessionId));
    if (!session || session.revokedAt || session.status !== "active") {
      await this.refresh.revoke([outcome.sessionId]);
      throw new AppError("UNAUTHENTICATED");
    }
    if (outcome.result === "OK") {
      await this.database.db
        .update(sessions)
        .set({
          lastActiveAt: this.clock.now(),
          ip: client.ip,
          userAgent: client.userAgent,
        })
        .where(eq(sessions.id, outcome.sessionId));
    }
    return this.tokens(outcome.sessionId, session.userId, outcome.token);
  }

  /** Logout with the refresh token the BFF holds. Unknown tokens are a no-op. */
  async logout(presented: string) {
    const sessionId = presented.split(".")[0] ?? "";
    const [session] = await this.database.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .catch(() => []);
    if (!session) return;
    await this.revoke(session.userId, [sessionId], "logout", {
      userId: session.userId,
    });
  }

  async list(userId: string) {
    return this.database.db
      .select({
        id: sessions.id,
        authMethod: sessions.authMethod,
        clientId: sessions.clientId,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
        createdAt: sessions.createdAt,
        lastActiveAt: sessions.lastActiveAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastActiveAt))
      .limit(100);
  }

  /** Revokes sessions of one user (ownership is part of the WHERE clause). */
  async revoke(
    userId: string,
    sessionIds: string[] | "all",
    reason: RevokeReason,
    actor: { userId: string | null },
    options: { except?: string } = {},
  ) {
    const now = this.clock.now();
    const revoked = await this.database.db.transaction(async (tx) => {
      const rows = await tx
        .update(sessions)
        .set({ revokedAt: now, revokedReason: reason })
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            sessionIds === "all" ? undefined : inArray(sessions.id, sessionIds),
            options.except ? ne(sessions.id, options.except) : undefined,
          ),
        )
        .returning({ id: sessions.id });
      for (const row of rows) {
        await enqueueEvent(
          tx,
          createEvent(identitySessionRevoked, {
            aggregateId: row.id,
            aggregateVersion: 2,
            occurredAt: now,
            payload: { userId, sessionId: row.id, reason },
          }),
        );
      }
      return rows.map((row) => row.id);
    });
    // Valkey after commit: a failure here leaves a DB-revoked session, which
    // rotate() also rejects, so revocation always wins.
    await this.refresh.revoke(revoked);
    if (revoked.length) this.relay.kick();
    this.logger.log(
      { userId, count: revoked.length, reason, actor: actor.userId },
      "Sessions revoked",
    );
    return revoked;
  }

  private async onReuse(sessionId: string, client: ClientContext) {
    const now = this.clock.now();
    const [session] = await this.database.db
      .select({ userId: sessions.userId })
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!session) return;
    this.logger.warn(
      { sessionId, ip: client.ip },
      "Refresh token reuse detected",
    );
    await this.revoke(session.userId, [sessionId], "reuse_detected", {
      userId: null,
    });
    await this.database.db.transaction((tx) =>
      enqueueEvent(
        tx,
        createEvent(notificationRequested, {
          producer: "identity",
          aggregateId: session.userId,
          aggregateVersion: 1,
          occurredAt: now,
          payload: {
            sourceEventId: globalThis.crypto.randomUUID(),
            templateKey: "security.session-revoked",
            category: "security",
            recipient: { userId: session.userId },
            data: { reason: "reuse_detected", ip: client.ip ?? "" },
          },
        }),
      ),
    );
    this.relay.kick();
  }

  private async tokens(
    sessionId: string,
    userId: string,
    refreshToken: string,
  ) {
    const now = this.clock.now();
    const [user] = await this.database.db
      .select({ accessVersion: users.accessVersion })
      .from(users)
      .where(eq(users.id, userId));
    const access = await this.keys.sign(
      {
        userId,
        sessionId,
        roles: await this.roles.activeRoles(userId),
        accessVersion: user?.accessVersion ?? 0,
      },
      now,
    );
    return {
      sessionId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(
        now.getTime() + this.config.refreshTtlSec * 1000,
      ).toISOString(),
    };
  }
}
