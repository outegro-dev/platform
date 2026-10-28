import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  type AuthenticatedUser,
  CLOCK,
  type Clock,
  DATABASE,
} from "@outegro/nest-common";
import type { RoundTimings } from "@outegro/roulette-engine";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RouletteDatabase } from "../common/database.js";
import { FAIR_ROLL, ROUND_TIMINGS, WALLET } from "../common/tokens.js";
import { adminAudit, bets, rounds } from "../db/schema.js";
import { betRef } from "../domain/ids.js";
import type { FairRollPort } from "../fair/fair-roll.port.js";
import type { WalletPort } from "../wallet/wallet.port.js";
import { RoundFeed, SnapshotService } from "./round.feed.js";
import { RoundRepository } from "./round.repository.js";
import { RoundStore } from "./round.store.js";

const VOIDABLE = ["betting", "locked", "rolling"] as const;

/**
 * Cancels a round and returns every bet (owner only, `roulette.void`). The
 * round becomes `voided` with one conditional update, which waits for bet
 * batches like the close does; payouts claim the round first (`paying`),
 * so a voided round never pays and a paying one cannot be voided. Each bet
 * goes back by rolling its debit back; a repeat of the command finishes the
 * refunds a wallet outage left. The round's seed is still revealed, so the
 * chain stays in order.
 */
@Injectable()
export class VoidService {
  private readonly logger = new Logger("VoidService");

  constructor(
    @Inject(DATABASE) private readonly database: RouletteDatabase,
    private readonly repo: RoundRepository,
    private readonly store: RoundStore,
    private readonly snapshots: SnapshotService,
    private readonly feed: RoundFeed,
    @Inject(WALLET) private readonly wallet: WalletPort,
    @Inject(FAIR_ROLL) private readonly fair: FairRollPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROUND_TIMINGS) private readonly timings: RoundTimings,
  ) {}

  async void(
    actor: AuthenticatedUser,
    roundId: number,
    input: { reason: string; preview?: boolean },
    requestId: string | undefined,
  ) {
    const round = await this.repo.find(roundId);
    if (!round) throw new AppError("NOT_FOUND");
    const voidable = (VOIDABLE as readonly string[]).includes(round.status);
    if (!voidable && round.status !== "voided")
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { round: [`cannot void a ${round.status} round`] },
      });
    const open = (await this.repo.betsOf(roundId)).filter(
      (bet) => bet.status === "accepted",
    );
    const refunded = open.reduce((sum, bet) => sum + bet.amount, 0);
    if (input.preview)
      return { preview: true, round: roundId, bets: open.length, refunded };

    if (voidable) {
      await this.store.lock(roundId);
      const now = this.clock.now();
      const changed = await this.database.db.transaction(async (tx) => {
        const [row] = await tx
          .update(rounds)
          .set({
            status: "voided",
            nextRoundAt: new Date(now.getTime() + this.timings.settledMs),
          })
          .where(
            and(eq(rounds.id, roundId), inArray(rounds.status, [...VOIDABLE])),
          )
          .returning({ id: rounds.id });
        if (!row) return false;
        await tx.insert(adminAudit).values({
          id: randomUUID(),
          actorId: actor.userId,
          action: "round.void",
          subject: `round:${roundId}`,
          reason: input.reason,
          before: { status: round.status, bets: open.length, refunded },
          after: { status: "voided" },
          requestId: requestId ?? null,
          createdAt: now,
        });
        return true;
      });
      // Payouts claimed the round in the meantime: it can no longer be voided.
      if (!changed && (await this.repo.find(roundId))?.status !== "voided")
        throw new AppError("CONFLICT", {
          fieldErrors: { round: ["paying out already"] },
        });
      this.logger.warn({ round: roundId, actor: actor.userId }, "Round voided");
    }

    const returned = await this.refund(roundId);
    await this.revealIfNeeded(roundId);
    const view = await this.snapshots.latest();
    if (view) await this.feed.publish(view);
    return {
      preview: false,
      round: roundId,
      bets: returned.count,
      refunded: returned.sum,
    };
  }

  /** Rolls back every bet still open, and every debit that never made it in. */
  private async refund(roundId: number) {
    const open = (await this.repo.betsOf(roundId)).filter(
      (bet) => bet.status === "accepted",
    );
    let count = 0;
    let sum = 0;
    for (const bet of open) {
      await this.wallet.rollback(betRef(bet.id));
      await this.database.db
        .update(bets)
        .set({ status: "refunded", payout: 0, settledAt: this.clock.now() })
        .where(and(eq(bets.id, bet.id), eq(bets.status, "accepted")));
      count += 1;
      sum += bet.amount;
    }
    const pending = await this.store.pending(roundId);
    const recorded = await this.repo.existing(pending);
    const stragglers = pending.filter((betId) => !recorded.has(betId));
    for (const betId of stragglers) await this.wallet.rollback(betRef(betId));
    await this.store.dropPending(roundId, stragglers);
    await this.database.db
      .update(rounds)
      .set({
        bets: sql`(select count(*) from ${bets} where ${bets.roundId} = ${roundId})`,
        staked: sql`(select coalesce(sum(${bets.amount}), 0) from ${bets} where ${bets.roundId} = ${roundId})`,
        paidOut: 0,
      })
      .where(eq(rounds.id, roundId));
    return { count, sum };
  }

  /** The chain is revealed strictly in order: a voided round still spends its seed. */
  private async revealIfNeeded(roundId: number) {
    const round = await this.repo.find(roundId);
    if (!round || round.seed !== null) return;
    const reveal = await this.fair.reveal(roundId);
    await this.database.db
      .update(rounds)
      .set({ seed: reveal.seed, number: reveal.number })
      .where(eq(rounds.id, roundId));
  }
}
