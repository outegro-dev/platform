import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { ClientContext } from "../common/client-context.js";
import type { AuthDatabase } from "../common/database.js";
import { oauthConfig } from "../config/config.js";
import { authorizationCodes, users } from "../db/schema.js";
import { SessionsService } from "../sessions/sessions.service.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const hex = (value: string) => sha256(value).toString("hex");
const base64url = (buffer: Buffer) => buffer.toString("base64url");

/**
 * Central sign-in for platform apps (ID-04): authorization code bound to a
 * registered client, its exact redirect URI and a PKCE S256 challenge. Each
 * app gets its own session; this is a deliberately small flow, not OIDC.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(oauthConfig.KEY)
    private readonly config: ConfigType<typeof oauthConfig>,
    private readonly sessions: SessionsService,
    private readonly relay: OutboxRelay,
  ) {}

  /** The registered client, only when the redirect URI matches exactly. */
  client(clientId: string, redirectUri: string) {
    const client = this.config.clients.find((c) => c.id === clientId);
    if (!client?.redirectUris.includes(redirectUri)) {
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { redirectUri: ["unregistered"] },
      });
    }
    return { id: client.id, name: client.name };
  }

  /** Issues a 60-second one-time code for the signed-in user. */
  async authorize(
    userId: string,
    input: { clientId: string; redirectUri: string; codeChallenge: string },
  ) {
    this.client(input.clientId, input.redirectUri);
    const now = this.clock.now();
    const code = base64url(randomBytes(32));
    const expiresAt = new Date(now.getTime() + this.config.codeTtlMs);
    await this.database.db.insert(authorizationCodes).values({
      codeHash: hex(code),
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      userId,
      expiresAt,
      createdAt: now,
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Exchanges a code for a new app session. Wrong client, redirect or PKCE
   * verifier, expiry or a second use all fail before any session exists.
   */
  async exchange(
    input: {
      clientId: string;
      redirectUri: string;
      code: string;
      codeVerifier: string;
    },
    context: ClientContext,
  ) {
    const now = this.clock.now();
    const [consumed] = await this.database.db
      .update(authorizationCodes)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authorizationCodes.codeHash, hex(input.code)),
          isNull(authorizationCodes.consumedAt),
          gt(authorizationCodes.expiresAt, now),
        ),
      )
      .returning();
    if (!consumed) throw invalidGrant();
    // The code is spent even when the checks below fail: no second guess.
    const challenge = base64url(sha256(input.codeVerifier));
    if (
      consumed.clientId !== input.clientId ||
      consumed.redirectUri !== input.redirectUri ||
      consumed.codeChallenge !== challenge
    ) {
      throw invalidGrant();
    }
    const sessionId = await this.database.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ status: users.status })
        .from(users)
        .where(eq(users.id, consumed.userId));
      if (user?.status !== "active") throw invalidGrant();
      return this.sessions.create(
        tx,
        consumed.userId,
        "sso",
        context,
        consumed.clientId,
      );
    });
    this.relay.kick();
    return this.sessions.issue(sessionId, consumed.userId);
  }
}

const invalidGrant = () =>
  new AppError("UNPROCESSABLE", { fieldErrors: { code: ["invalid_grant"] } });
