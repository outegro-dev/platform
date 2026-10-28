import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type {
  DailyClaim,
  DailyStatus,
  dailyBlockSchema,
} from "@outegro/contracts/daily-bonus";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, count, desc, eq, gte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { DailyDatabase } from "../common/database.js";
import { DailyMetrics } from "../common/metrics.js";
import { IDENTITY, PRIZE_RANDOM, WALLET } from "../common/tokens.js";
import { hashConfig } from "../config/config.js";
import { claims } from "../db/schema.js";
import type { IdentityPort, IdentityUser } from "../identity/identity.js";
import { type DailyWalletPort, WalletUnavailable } from "../wallet/wallet.js";
import {
  CLAIMS_PER_DEVICE,
  CLAIMS_PER_IP,
  COOLDOWN_MS,
  drawPrize,
  MIN_ACCOUNT_AGE_MS,
  nextStreak,
  streakBonusPercent,
  withStreak,
} from "./rules.js";
import { SettingsService } from "./settings.service.js";

type Block = z.infer<typeof dailyBlockSchema>;
type ClaimRow = typeof claims.$inferSelect;
const DAY_MS = 24 * 60 * 60 * 1000;

const bonusRef = (userId: string, claimNo: number) =>
  `daily:${userId}:${claimNo}`;

/** A claim refused before any draw; no grumbles moved. */
function blocked(reason: Block): AppError {
  return new AppError("FORBIDDEN", { fieldErrors: { reason: [reason] } });
}

/**
 * The daily bonus (owner, 28.10.2026): grumbles once every 24 hours from the
 * moment the last bonus was taken, a streak bonus for days in a row, and
 * guards against farming with many accounts: a verified email, an account
 * older than a day, and at most 3 bonuses a day per network and per device.
 * A claim is recorded first and credited after, with a ref the wallet keeps
 * unique, so a crash or a double click never pays twice.
 */
@Injectable()
export class BonusService {
  private readonly logger = new Logger("BonusService");

  constructor(
    @Inject(DATABASE) private readonly database: DailyDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY) private readonly identity: IdentityPort,
    @Inject(WALLET) private readonly wallet: DailyWalletPort,
    @Inject(PRIZE_RANDOM) private readonly random: () => number,
    @Inject(hashConfig.KEY)
    private readonly hash: ConfigType<typeof hashConfig>,
    private readonly settings: SettingsService,
    private readonly metrics: DailyMetrics,
  ) {}

  private get db() {
    return this.database.db;
  }

  async status(userId: string): Promise<DailyStatus> {
    const settings = await this.settings.current();
    const [user, last] = await Promise.all([
      this.identity.lookup(userId),
      this.last(userId),
    ]);
    const block = settings.enabled ? this.blockOf(user) : "disabled";
    const now = this.clock.now();
    const nextAt = last && now < last.nextAt ? last.nextAt : null;
    const streak = last
      ? nextStreak(last, now, settings.streaksEnabled) - 1
      : 0;
    return {
      available: block === null && nextAt === null,
      nextAt: block === null && nextAt ? nextAt.toISOString() : null,
      blocked: block,
      streak: settings.streaksEnabled ? streak : 0,
      streakBonusPercent: streakBonusPercent(
        streak + 1,
        settings.streaksEnabled,
      ),
      prizes: settings.prizes,
    };
  }

  async claim(
    userId: string,
    client: { ip: string | undefined; device: string | undefined },
  ): Promise<DailyClaim> {
    const settings = await this.settings.current();
    if (!settings.enabled) throw this.refuse(blocked("disabled"), "disabled");
    const block = this.blockOf(await this.identity.lookup(userId));
    if (block) throw this.refuse(blocked(block), block);
    const ipHash = client.ip ? this.hashOf("ip", client.ip) : null;
    const deviceHash = client.device
      ? this.hashOf("device", client.device)
      : null;

    const claim = await this.db.transaction(async (tx) => {
      // One claim at a time per player; a double click waits here.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
      const [last] = await tx
        .select()
        .from(claims)
        .where(eq(claims.userId, userId))
        .orderBy(desc(claims.claimNo))
        .limit(1);
      const now = this.clock.now();
      // A claim the wallet has not confirmed yet is finished, not repeated.
      if (last?.status === "pending") return last;
      if (last && now < last.nextAt) {
        // The click that just took it: the same claim, not an error.
        if (now.getTime() - last.claimedAt.getTime() < 10_000) return last;
        throw new AppError("CONFLICT", {
          fieldErrors: { nextAt: [last.nextAt.toISOString()] },
        });
      }
      const since = new Date(now.getTime() - DAY_MS);
      for (const [column, value, limit, reason] of [
        [claims.ipHash, ipHash, CLAIMS_PER_IP, "ip_limit"],
        [claims.deviceHash, deviceHash, CLAIMS_PER_DEVICE, "device_limit"],
      ] as const) {
        if (!value) continue;
        const [used] = await tx
          .select({ n: count() })
          .from(claims)
          .where(
            and(
              eq(column, value),
              gte(claims.claimedAt, since),
              ne(claims.userId, userId),
            ),
          );
        // Other accounts already took the network's or device's share today.
        if ((used?.n ?? 0) >= limit)
          throw this.refuse(
            new AppError("RATE_LIMITED", { fieldErrors: { reason: [reason] } }),
            reason,
          );
      }
      const streak = nextStreak(last ?? null, now, settings.streaksEnabled);
      const prizeIndex = drawPrize(settings.prizes, this.random);
      const basePrize = settings.prizes[prizeIndex]?.amount ?? 0;
      const prize = withStreak(
        basePrize,
        streakBonusPercent(streak, settings.streaksEnabled),
      );
      const [created] = await tx
        .insert(claims)
        .values({
          userId,
          claimNo: (last?.claimNo ?? 0) + 1,
          status: "pending",
          prizeIndex,
          basePrize,
          prize,
          streak,
          claimedAt: now,
          nextAt: new Date(now.getTime() + COOLDOWN_MS),
          ipHash,
          deviceHash,
          settingsVersion: settings.version,
        })
        .returning();
      if (!created) throw new Error("claim not stored");
      return created;
    });
    return this.grant(claim);
  }

  /** Credits a recorded claim; the wallet answers a repeat with the first result. */
  private async grant(claim: ClaimRow): Promise<DailyClaim> {
    let balance: number | null = null;
    try {
      ({ balance } = await this.wallet.credit({
        userId: claim.userId,
        amount: claim.prize,
        ref: bonusRef(claim.userId, claim.claimNo),
        objectRef: `claim:${claim.claimNo}`,
        meta: { streak: claim.streak, basePrize: claim.basePrize },
      }));
    } catch (error) {
      this.metrics.claim("wallet_unavailable");
      this.logger.warn(
        { claimNo: claim.claimNo, err: (error as Error).message },
        "Bonus credit failed; the claim waits for a retry",
      );
      throw new AppError("DEPENDENCY_UNAVAILABLE", {
        cause: error instanceof WalletUnavailable ? error : undefined,
      });
    }
    if (claim.status === "pending") {
      await this.db
        .update(claims)
        .set({ status: "granted", grantedAt: this.clock.now() })
        .where(
          and(
            eq(claims.userId, claim.userId),
            eq(claims.claimNo, claim.claimNo),
            eq(claims.status, "pending"),
          ),
        );
      this.metrics.granted(claim.prize);
    }
    this.metrics.claim("granted");
    return {
      claimNo: claim.claimNo,
      prizeIndex: claim.prizeIndex,
      basePrize: claim.basePrize,
      prize: claim.prize,
      streak: claim.streak,
      nextAt: claim.nextAt.toISOString(),
      balance,
    };
  }

  private blockOf(user: IdentityUser): Block | null {
    if (user.status !== "active") return "account_closed";
    if (!user.emailVerified) return "email_unverified";
    if (
      this.clock.now().getTime() - user.createdAt.getTime() <
      MIN_ACCOUNT_AGE_MS
    )
      return "account_too_new";
    return null;
  }

  private refuse(error: AppError, reason: string): AppError {
    this.metrics.claim(reason);
    return error;
  }

  private hashOf(kind: "ip" | "device", value: string): string {
    return createHash("sha256")
      .update(`${this.hash.pepper}:${kind}:${value}`)
      .digest("base64url");
  }

  private async last(userId: string): Promise<ClaimRow | null> {
    const [row] = await this.db
      .select()
      .from(claims)
      .where(eq(claims.userId, userId))
      .orderBy(desc(claims.claimNo))
      .limit(1);
    return row ?? null;
  }
}
