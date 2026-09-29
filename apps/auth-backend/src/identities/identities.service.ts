import { Inject, Injectable } from "@nestjs/common";
import {
  createEvent,
  type Locale,
  notificationRequested,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
  RateLimiter,
} from "@outegro/nest-common";
import { and, eq } from "drizzle-orm";
import { audit } from "../common/audit.js";
import type { ClientContext } from "../common/client-context.js";
import type { AuthDatabase, AuthTx } from "../common/database.js";
import { IdentityMetrics } from "../common/metrics.js";
import { identities, users } from "../db/schema.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { SignInMethods } from "../users/sign-in-methods.js";
import { UsersService } from "../users/users.service.js";
import {
  GOOGLE_PROVIDER,
  type GoogleCode,
  type GoogleProfile,
  type GoogleProvider,
  GoogleRejected,
  GoogleUnavailable,
} from "./google.provider.js";

/**
 * Google as a sign-in method (ID-02). Signing in and linking are separate use
 * cases: a Google account whose email matches an existing user is never
 * attached to it automatically; the owner links it while signed in.
 */
@Injectable()
export class IdentitiesService {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GOOGLE_PROVIDER) private readonly google: GoogleProvider,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly methods: SignInMethods,
    private readonly relay: OutboxRelay,
    private readonly limiter: RateLimiter,
    private readonly metrics: IdentityMetrics,
  ) {}

  /** What id-web needs to build the Google authorization request. */
  config() {
    return {
      enabled: this.google.enabled,
      clientId: this.google.clientId,
      redirectUri: this.google.redirectUri,
    };
  }

  /** An existing link signs in; an unknown Google account gets a new user. */
  signIn(input: GoogleCode & { locale: Locale }, client: ClientContext) {
    return this.metrics.signIn("google", this.authenticate(input, client));
  }

  private async authenticate(
    input: GoogleCode & { locale: Locale },
    client: ClientContext,
  ) {
    if (client.ip) {
      const limit = await this.limiter.consume(
        `login:google-ip:${client.ip}`,
        30,
        600_000,
      );
      if (!limit.allowed)
        throw new AppError("RATE_LIMITED", { retryable: true });
    }
    const profile = await this.profile(input);
    const now = this.clock.now();
    const { user, sessionId } = await this.database.db.transaction(
      async (tx) => {
        let user = await this.linkedUser(tx, profile.subject);
        if (!user) {
          if (!profile.email || !profile.emailVerified)
            throw new AppError("UNPROCESSABLE", {
              fieldErrors: { email: ["unverified"] },
            });
          const created = await this.users.createVerified(
            tx,
            profile.email,
            input.locale,
            profile.name,
          );
          if (created) {
            await this.attach(tx, created.id, profile, now, "signup");
            user = created;
          } else {
            // A concurrent first sign-in may have just created and linked it.
            user = await this.linkedUser(tx, profile.subject);
            if (!user)
              throw new AppError("CONFLICT", {
                fieldErrors: { email: ["link_required"] },
              });
          }
        }
        if (user.status !== "active") throw new AppError("FORBIDDEN");
        const id = await this.sessions.create(tx, user.id, "google", client);
        return { user, sessionId: id };
      },
    );
    this.relay.kick();
    const tokens = await this.sessions.issue(sessionId, user.id);
    return { ...tokens, user: this.users.toProfile(user) };
  }

  /** Links a Google account to the signed-in user; ownership is the session. */
  async link(userId: string, input: GoogleCode) {
    const profile = await this.profile(input);
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.provider, "google"),
            eq(identities.subject, profile.subject),
          ),
        );
      if (existing) {
        if (existing.userId === userId) return;
        throw new AppError("CONFLICT", {
          fieldErrors: { identity: ["in_use"] },
        });
      }
      const attached = await this.attach(tx, userId, profile, now, "link");
      if (!attached)
        throw new AppError("CONFLICT", {
          fieldErrors: { identity: ["already_linked"] },
        });
      await this.notify(tx, userId, "security.google-linked.v1", attached, now);
    });
    this.relay.kick();
    return this.list(userId);
  }

  /** Refuses to remove the last way to sign in (TC-ID-02-03, SignInMethods). */
  async unlink(userId: string) {
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!user) throw new AppError("NOT_FOUND");
      const [google] = await tx
        .select()
        .from(identities)
        .where(
          and(eq(identities.userId, userId), eq(identities.provider, "google")),
        );
      if (!google) throw new AppError("NOT_FOUND");
      const others = await this.methods.remainingAfter(tx, user, {
        google: true,
      });
      if (others === 0)
        throw new AppError("CONFLICT", {
          fieldErrors: { identity: ["last_method"] },
        });
      await tx.delete(identities).where(eq(identities.id, google.id));
      await audit(tx, {
        actorId: userId,
        action: "identity.unlinked",
        targetType: "user",
        targetId: userId,
        data: { provider: "google" },
        at: now,
      });
      await this.notify(
        tx,
        userId,
        "security.google-unlinked.v1",
        google.id,
        now,
      );
    });
    this.relay.kick();
  }

  async list(userId: string) {
    const rows = await this.database.db
      .select({
        provider: identities.provider,
        email: identities.email,
        createdAt: identities.createdAt,
      })
      .from(identities)
      .where(eq(identities.userId, userId));
    return {
      items: rows.map((row) => ({
        provider: row.provider,
        email: row.email,
        linkedAt: row.createdAt.toISOString(),
      })),
    };
  }

  private async profile(input: GoogleCode): Promise<GoogleProfile> {
    if (!this.google.enabled) throw new AppError("NOT_FOUND");
    try {
      return await this.google.verify(input);
    } catch (error) {
      if (error instanceof GoogleUnavailable)
        throw new AppError("DEPENDENCY_UNAVAILABLE", { retryable: true });
      if (error instanceof GoogleRejected)
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { code: ["invalid_grant"] },
        });
      throw error;
    }
  }

  private async linkedUser(tx: AuthTx, subject: string) {
    const [row] = await tx
      .select({ user: users })
      .from(identities)
      .innerJoin(users, eq(users.id, identities.userId))
      .where(
        and(eq(identities.provider, "google"), eq(identities.subject, subject)),
      );
    return row?.user ?? null;
  }

  /** Inserts the link; its id, or null when this user already has a Google account. */
  private async attach(
    tx: AuthTx,
    userId: string,
    profile: GoogleProfile,
    at: Date,
    via: "signup" | "link",
  ) {
    const [row] = await tx
      .insert(identities)
      .values({
        userId,
        provider: "google",
        subject: profile.subject,
        email: profile.email,
        createdAt: at,
      })
      .onConflictDoNothing()
      .returning({ id: identities.id });
    if (!row) return null;
    await audit(tx, {
      actorId: userId,
      action: "identity.linked",
      targetType: "user",
      targetId: userId,
      data: { provider: "google", via },
      at,
    });
    return row.id;
  }

  /**
   * Security notice for the owner, in the transaction of the change (N-06).
   * The identity row is the source: one message per link and per unlink.
   */
  private notify(
    tx: AuthTx,
    userId: string,
    templateKey: string,
    identityId: string,
    at: Date,
  ) {
    return enqueueEvent(
      tx,
      createEvent(notificationRequested, {
        producer: "identity",
        aggregateId: userId,
        aggregateVersion: 1,
        occurredAt: at,
        payload: {
          sourceEventId: identityId,
          templateKey,
          category: "security",
          recipient: { userId },
          data: { at: at.toISOString() },
        },
      }),
    );
  }
}
