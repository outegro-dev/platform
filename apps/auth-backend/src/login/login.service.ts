import {
  createHash,
  createHmac,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type { Locale } from "@outegro/contracts";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
  RateLimiter,
} from "@outegro/nest-common";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { ClientContext } from "../common/client-context.js";
import type { AuthDatabase } from "../common/database.js";
import { IdentityMetrics } from "../common/metrics.js";
import { loginConfig } from "../config/config.js";
import { loginChallenges } from "../db/schema.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { UsersService } from "../users/users.service.js";
import { CODE_DELIVERY, type CodeDelivery } from "./code-delivery.js";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

@Injectable()
export class LoginService {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(loginConfig.KEY)
    private readonly config: ConfigType<typeof loginConfig>,
    @Inject(CODE_DELIVERY) private readonly delivery: CodeDelivery,
    private readonly limiter: RateLimiter,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly relay: OutboxRelay,
    private readonly metrics: IdentityMetrics,
  ) {}

  /**
   * Step 1. The same response whether or not an account exists; the user
   * is created only after a correct code.
   */
  async requestChallenge(
    rawEmail: string,
    locale: Locale,
    client: ClientContext,
  ) {
    const email = rawEmail.trim().toLowerCase();
    await this.limit(
      `login:resend:${digest(email)}`,
      1,
      this.config.resendCooldownMs,
    );
    await this.limit(`login:email-day:${digest(email)}`, 10, 24 * 3600_000);
    if (client.ip) await this.limit(`login:ip:${client.ip}`, 20, 3600_000);

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.codeTtlSec * 1000);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const challengeId = globalThis.crypto.randomUUID();
    await this.database.db.insert(loginChallenges).values({
      id: challengeId,
      email,
      codeHash: this.hash(challengeId, code),
      locale,
      expiresAt,
      createdAt: now,
    });

    const status = await this.delivery.deliver(
      { challengeId, email, code, locale, expiresAt: expiresAt.toISOString() },
      client.requestId,
    );
    this.metrics.loginCode(status);
    await this.database.db
      .update(loginChallenges)
      .set({ deliveryStatus: status })
      .where(eq(loginChallenges.id, challengeId));

    return {
      challengeId,
      expiresAt: expiresAt.toISOString(),
      resendAfter: new Date(
        now.getTime() + this.config.resendCooldownMs,
      ).toISOString(),
      deliveryStatus: status,
    };
  }

  /** Step 2. A code works once, before expiry, within the attempt budget. */
  verify(challengeId: string, code: string, client: ClientContext) {
    return this.metrics.signIn(
      "email",
      this.checkCode(challengeId, code, client),
    );
  }

  private async checkCode(
    challengeId: string,
    code: string,
    client: ClientContext,
  ) {
    if (client.ip)
      await this.limit(`login:verify-ip:${client.ip}`, 30, 600_000);
    const now = this.clock.now();
    const [challenge] = await this.database.db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.id, challengeId));
    if (!challenge || challenge.consumedAt) throw invalid("invalid_code");
    if (challenge.expiresAt <= now) throw invalid("expired");
    if (challenge.attempts >= this.config.maxAttempts)
      throw invalid("too_many_attempts");

    const expected = Buffer.from(challenge.codeHash, "hex");
    const actual = Buffer.from(this.hash(challengeId, code), "hex");
    if (!timingSafeEqual(expected, actual)) {
      const [row] = await this.database.db
        .update(loginChallenges)
        .set({ attempts: sql`${loginChallenges.attempts} + 1` })
        .where(
          and(
            eq(loginChallenges.id, challengeId),
            isNull(loginChallenges.consumedAt),
          ),
        )
        .returning({ attempts: loginChallenges.attempts });
      throw invalid(
        (row?.attempts ?? 0) >= this.config.maxAttempts
          ? "too_many_attempts"
          : "invalid_code",
      );
    }

    // Atomic consume: of two concurrent correct verifications only one wins.
    const [consumed] = await this.database.db
      .update(loginChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(loginChallenges.id, challengeId),
          isNull(loginChallenges.consumedAt),
          gt(loginChallenges.expiresAt, now),
          lt(loginChallenges.attempts, this.config.maxAttempts),
        ),
      )
      .returning({
        email: loginChallenges.email,
        locale: loginChallenges.locale,
      });
    if (!consumed) throw invalid("invalid_code");

    const { user, sessionId } = await this.database.db.transaction(
      async (tx) => {
        const found = await this.users.findOrCreateVerified(
          tx,
          consumed.email,
          consumed.locale,
        );
        if (found.status !== "active") throw new AppError("FORBIDDEN");
        const id = await this.sessions.create(tx, found.id, "email", client);
        return { user: found, sessionId: id };
      },
    );
    this.relay.kick();
    const tokens = await this.sessions.issue(sessionId, user.id);
    return { ...tokens, user: this.users.toProfile(user) };
  }

  private hash(challengeId: string, code: string) {
    return createHmac("sha256", this.config.pepper)
      .update(`${challengeId}:${code}`)
      .digest("hex");
  }

  private async limit(key: string, limit: number, windowMs: number) {
    const result = await this.limiter.consume(key, limit, windowMs);
    if (!result.allowed) {
      throw new AppError("RATE_LIMITED", {
        retryable: true,
        fieldErrors: { retryAfterMs: [String(result.retryAfterMs)] },
      });
    }
  }
}

const invalid = (reason: "invalid_code" | "expired" | "too_many_attempts") =>
  new AppError("UNPROCESSABLE", { fieldErrors: { code: [reason] } });
