import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { createEvent, notificationRequested } from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
  RateLimiter,
} from "@outegro/nest-common";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { and, asc, count, eq, isNull, or, sql } from "drizzle-orm";
import { audit } from "../common/audit.js";
import type { ClientContext } from "../common/client-context.js";
import type { AuthDatabase, AuthTx } from "../common/database.js";
import { IdentityMetrics } from "../common/metrics.js";
import { webauthnConfig } from "../config/config.js";
import { passkeys, sessions, users } from "../db/schema.js";
import { SessionsService } from "../sessions/sessions.service.js";
import { SignInMethods } from "../users/sign-in-methods.js";
import { UsersService } from "../users/users.service.js";
import { ChallengeStore } from "./challenge-store.js";

type Passkey = typeof passkeys.$inferSelect;

/** WebAuthn transport hints worth keeping (L3 list plus the older "cable"). */
const TRANSPORTS: readonly string[] = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

/**
 * The WebAuthn user handle of an account: the 16 bytes of its UUID. It is
 * stable per user, so an authenticator keeps one passkey per account, and it
 * carries no email or name (WebAuthn §14.6.1).
 */
export const userHandleOf = (userId: string) =>
  new Uint8Array(Buffer.from(userId.replaceAll("-", ""), "hex"));
const handleString = (userId: string) =>
  Buffer.from(userHandleOf(userId)).toString("base64url");

/** Unknown, expired or already used: the browser has to start over. */
const stale = () =>
  new AppError("UNPROCESSABLE", { fieldErrors: { challenge: ["stale"] } });
/** The response did not prove what it had to; nothing is said about why. */
const rejected = () =>
  new AppError("UNPROCESSABLE", { fieldErrors: { passkey: ["rejected"] } });

/**
 * Passkeys (ID-05) with SimpleWebAuthn: RP `WEBAUTHN_RP_ID`, ceremonies
 * accepted only from `WEBAUTHN_ORIGIN`, user verification required in both
 * ceremonies, one-time challenges in Valkey. Signing in with a passkey is an
 * ordinary Identity session (`auth_method = passkey`), so SSO for the other
 * apps works exactly as after an email code.
 */
@Injectable()
export class PasskeysService {
  private readonly logger = new Logger("Passkeys");

  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(webauthnConfig.KEY)
    private readonly config: ConfigType<typeof webauthnConfig>,
    private readonly challenges: ChallengeStore,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly methods: SignInMethods,
    private readonly limiter: RateLimiter,
    private readonly relay: OutboxRelay,
    private readonly metrics: IdentityMetrics,
  ) {}

  // ─── Registration ────────────────────────────────────────────────────

  /**
   * Creation options for the signed-in user. Only an id.outegro.dev session
   * signed in at most `freshSignInMs` ago may add a passkey: a stolen older
   * session cannot plant its own key. Otherwise the user signs in again.
   */
  async registrationOptions(current: AuthenticatedUser) {
    await this.limit(`passkey:register:${current.userId}`, 20, 3600_000);
    const [row] = await this.database.db
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, current.sessionId),
          eq(sessions.userId, current.userId),
          isNull(sessions.revokedAt),
        ),
      );
    if (!row) throw new AppError("UNAUTHENTICATED");
    if (row.user.status !== "active") throw new AppError("FORBIDDEN");
    this.assertFresh(row.session);

    const existing = await this.database.db
      .select({
        credentialId: passkeys.credentialId,
        transports: passkeys.transports,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, current.userId));
    if (existing.length >= this.config.maxPerUser) throw tooMany();

    const options = await generateRegistrationOptions({
      rpName: this.config.rpName,
      rpID: this.config.rpId,
      userID: userHandleOf(row.user.id),
      userName: row.user.email,
      userDisplayName: row.user.displayName ?? row.user.email,
      timeout: this.config.challengeTtlMs,
      attestationType: "none",
      // The same authenticator twice would replace its own passkey.
      excludeCredentials: existing.map((key) => ({
        id: key.credentialId,
        transports: knownTransports(key.transports),
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    });
    const challengeId = await this.challenges.put(
      "registration",
      {
        challenge: options.challenge,
        userId: current.userId,
        sessionId: current.sessionId,
      },
      this.config.challengeTtlMs,
    );
    return { challengeId, options };
  }

  /**
   * Verifies the new credential against the challenge of this user and
   * session, then stores it with an audit entry and a security notice in
   * one transaction.
   */
  async register(
    current: AuthenticatedUser,
    input: {
      challengeId: string;
      name: string;
      response: RegistrationResponseJSON;
    },
    client: ClientContext,
  ) {
    const stored = await this.challenges.take(
      "registration",
      input.challengeId,
    );
    if (
      !stored ||
      stored.userId !== current.userId ||
      stored.sessionId !== current.sessionId
    )
      throw stale();

    let info: Awaited<
      ReturnType<typeof verifyRegistrationResponse>
    >["registrationInfo"];
    try {
      const verification = await verifyRegistrationResponse({
        response: input.response,
        expectedChallenge: stored.challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
      });
      info = verification.registrationInfo;
    } catch (error) {
      this.refused("registration", current.userId, error);
      throw rejected();
    }
    if (!info || info.credential.id !== input.response.id) throw rejected();

    const now = this.clock.now();
    const credential = info.credential;
    const created = await this.database.db.transaction(async (tx) => {
      const user = await lockUser(tx, current.userId);
      if (user.status !== "active") throw new AppError("FORBIDDEN");
      const [held] = await tx
        .select({ n: count() })
        .from(passkeys)
        .where(eq(passkeys.userId, user.id));
      if ((held?.n ?? 0) >= this.config.maxPerUser) throw tooMany();
      const [row] = await tx
        .insert(passkeys)
        .values({
          userId: user.id,
          credentialId: credential.id,
          publicKey: credential.publicKey,
          signCount: credential.counter,
          transports: knownTransports(credential.transports ?? []),
          aaguid: info.aaguid,
          rpId: this.config.rpId,
          backupEligible: info.credentialDeviceType === "multiDevice",
          backedUp: info.credentialBackedUp,
          name: input.name,
          createdAt: now,
        })
        .onConflictDoNothing({ target: passkeys.credentialId })
        .returning();
      // One credential belongs to one account, whoever tries to add it again.
      if (!row)
        throw new AppError("CONFLICT", {
          fieldErrors: { passkey: ["already_registered"] },
        });
      await audit(tx, {
        actorId: user.id,
        action: "passkey.registered",
        targetType: "user",
        targetId: user.id,
        data: {
          passkeyId: row.id,
          aaguid: row.aaguid,
          backupEligible: row.backupEligible,
        },
        requestId: client.requestId,
        at: now,
      });
      await this.notify(tx, user.id, "security.passkey-added.v1", row.id, now);
      return row;
    });
    this.relay.kick();
    return this.toItem(created);
  }

  // ─── Sign-in ─────────────────────────────────────────────────────────

  /** Options for a usernameless sign-in: any passkey of this RP may answer. */
  async authenticationOptions(client: ClientContext) {
    if (client.ip)
      await this.limit(`login:passkey-options:${client.ip}`, 60, 600_000);
    const options = await generateAuthenticationOptions({
      rpID: this.config.rpId,
      userVerification: "required",
      timeout: this.config.challengeTtlMs,
    });
    const challengeId = await this.challenges.put(
      "authentication",
      { challenge: options.challenge },
      this.config.challengeTtlMs,
    );
    return { challengeId, options };
  }

  signIn(
    input: { challengeId: string; response: AuthenticationResponseJSON },
    client: ClientContext,
  ) {
    return this.metrics.signIn("passkey", this.authenticate(input, client));
  }

  private async authenticate(
    input: { challengeId: string; response: AuthenticationResponseJSON },
    client: ClientContext,
  ) {
    if (client.ip)
      await this.limit(`login:passkey-ip:${client.ip}`, 30, 600_000);
    // Taken first: whatever happens next, this challenge never works again.
    const stored = await this.challenges.take(
      "authentication",
      input.challengeId,
    );
    if (!stored) throw stale();

    const { response } = input;
    const [found] = await this.database.db
      .select()
      .from(passkeys)
      .where(
        and(
          eq(passkeys.credentialId, response.id),
          eq(passkeys.rpId, this.config.rpId),
        ),
      );
    if (!found)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { passkey: ["unknown"] },
      });
    // A discoverable credential names its account (WebAuthn §7.2 step 6):
    // it has to be the account this credential was registered to.
    if (response.response.userHandle !== handleString(found.userId)) {
      this.refused("authentication", found.userId, "user handle mismatch");
      throw rejected();
    }

    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: stored.challenge,
        expectedOrigin: this.config.origin,
        expectedRPID: this.config.rpId,
        requireUserVerification: true,
        // The counter is compared below, once the signature is known to be
        // genuine, so a forged response cannot pass for a cloned key.
        credential: {
          id: found.credentialId,
          publicKey: found.publicKey,
          counter: 0,
          transports: knownTransports(found.transports),
        },
      });
    } catch (error) {
      this.refused("authentication", found.userId, error);
      throw rejected();
    }
    if (!verification.verified) {
      this.refused("authentication", found.userId, "bad signature");
      throw rejected();
    }

    const { newCounter, credentialBackedUp } = verification.authenticationInfo;
    const now = this.clock.now();
    const outcome = await this.database.db.transaction(async (tx) => {
      const user = await lockUser(tx, found.userId);
      if (user.status !== "active") throw new AppError("FORBIDDEN");
      // Compare-and-set on the counter: it has to grow, unless the
      // authenticator does not count at all (0 before and now).
      const [used] = await tx
        .update(passkeys)
        .set({
          signCount: newCounter,
          backedUp: credentialBackedUp,
          lastUsedAt: now,
        })
        .where(
          and(
            eq(passkeys.id, found.id),
            or(
              sql`${passkeys.signCount} < ${newCounter}`,
              and(eq(passkeys.signCount, 0), sql`${newCounter} = 0`),
            ),
          ),
        )
        .returning({ id: passkeys.id });
      if (!used) return { regressed: true as const };
      const sessionId = await this.sessions.create(
        tx,
        user.id,
        "passkey",
        client,
      );
      return { regressed: false as const, user, sessionId };
    });

    if (outcome.regressed) {
      // A correct signature with a counter that did not grow: most likely a
      // copy of the authenticator is in use. Refused and kept on record.
      await this.database.db.transaction((tx) =>
        audit(tx, {
          actorId: null,
          action: "passkey.counter_regression",
          targetType: "user",
          targetId: found.userId,
          data: {
            passkeyId: found.id,
            storedCounter: found.signCount,
            presentedCounter: newCounter,
          },
          requestId: client.requestId,
          at: now,
        }),
      );
      this.logger.warn(
        { userId: found.userId, passkeyId: found.id, ip: client.ip },
        "Passkey signature counter did not grow; sign-in refused",
      );
      throw rejected();
    }
    this.relay.kick();
    const tokens = await this.sessions.issue(
      outcome.sessionId,
      outcome.user.id,
    );
    return { ...tokens, user: this.users.toProfile(outcome.user) };
  }

  // ─── Management ──────────────────────────────────────────────────────

  async list(userId: string) {
    const rows = await this.database.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt), asc(passkeys.id));
    return { items: rows.map((row) => this.toItem(row)) };
  }

  async rename(
    userId: string,
    passkeyId: string,
    name: string,
    client: ClientContext,
  ) {
    const now = this.clock.now();
    const renamed = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(passkeys)
        .set({ name })
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)))
        .returning();
      if (!row) throw new AppError("NOT_FOUND");
      await audit(tx, {
        actorId: userId,
        action: "passkey.renamed",
        targetType: "user",
        targetId: userId,
        data: { passkeyId },
        requestId: client.requestId,
        at: now,
      });
      return row;
    });
    return this.toItem(renamed);
  }

  /**
   * Removes a passkey unless it is the last usable way to sign in
   * (TC-ID-05-03): then 409 `passkey: last_method`, nothing changes and the
   * user is told to add another method first.
   */
  async remove(userId: string, passkeyId: string, client: ClientContext) {
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const user = await lockUser(tx, userId);
      const [row] = await tx
        .select({ id: passkeys.id, rpId: passkeys.rpId })
        .from(passkeys)
        .where(and(eq(passkeys.id, passkeyId), eq(passkeys.userId, userId)));
      if (!row) throw new AppError("NOT_FOUND");
      const left = await this.methods.remainingAfter(tx, user, {
        passkeyId: row.id,
      });
      // A passkey of another RP signs nobody in: removing it takes nothing away.
      if (left === 0 && row.rpId === this.config.rpId)
        throw new AppError("CONFLICT", {
          fieldErrors: { passkey: ["last_method"] },
        });
      await tx.delete(passkeys).where(eq(passkeys.id, row.id));
      await audit(tx, {
        actorId: userId,
        action: "passkey.removed",
        targetType: "user",
        targetId: userId,
        data: { passkeyId: row.id },
        requestId: client.requestId,
        at: now,
      });
      await this.notify(tx, userId, "security.passkey-removed.v1", row.id, now);
    });
    this.relay.kick();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private assertFresh(session: { clientId: string | null; createdAt: Date }) {
    const age = this.clock.now().getTime() - session.createdAt.getTime();
    if (session.clientId !== null || age > this.config.freshSignInMs)
      throw new AppError("FORBIDDEN", {
        fieldErrors: { session: ["reauthentication_required"] },
      });
  }

  private toItem(row: Passkey) {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      /** Synced by its provider (backup eligible), and backed up right now. */
      synced: row.backupEligible,
      backedUp: row.backedUp,
      /** False for a passkey of another relying party: it cannot sign in. */
      usable: row.rpId === this.config.rpId,
    };
  }

  /**
   * Security notice for the owner in the transaction of the change (N-06).
   * Only the time travels: a passkey name is text the user (or whoever
   * holds the session) typed, and a notice never repeats it.
   */
  private notify(
    tx: AuthTx,
    userId: string,
    templateKey: string,
    passkeyId: string,
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
          sourceEventId: passkeyId,
          templateKey,
          category: "security",
          recipient: { userId },
          data: { at: at.toISOString() },
        },
      }),
    );
  }

  /**
   * Why a ceremony was refused goes to the log, never to the client. The
   * library quotes challenges in its messages; they are spent already, but
   * the log keeps only the kind of mismatch.
   */
  private refused(
    ceremony: "registration" | "authentication",
    userId: string,
    reason: unknown,
  ) {
    const message = reason instanceof Error ? reason.message : String(reason);
    this.logger.warn(
      {
        ceremony,
        userId,
        reason: /challenge/i.test(message)
          ? message.replace(/"[^"]*"/g, '"…"')
          : message.slice(0, 300),
      },
      "Passkey ceremony refused",
    );
  }

  private async limit(key: string, limit: number, windowMs: number) {
    const result = await this.limiter.consume(key, limit, windowMs);
    if (!result.allowed)
      throw new AppError("RATE_LIMITED", {
        retryable: true,
        fieldErrors: { retryAfterMs: [String(result.retryAfterMs)] },
      });
  }
}

const tooMany = () =>
  new AppError("UNPROCESSABLE", { fieldErrors: { passkey: ["limit"] } });

function knownTransports(values: readonly string[]) {
  return TRANSPORTS.filter((transport) => values.includes(transport));
}

/** The user row, locked for the rest of the transaction. */
async function lockUser(tx: AuthTx, userId: string) {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) throw new AppError("NOT_FOUND");
  return user;
}
