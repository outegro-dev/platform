import { Inject, Injectable } from "@nestjs/common";
import { DATABASE } from "@outegro/nest-common";
import {
  type Color,
  colorOf,
  multipliers,
  type RoundTimings,
} from "@outegro/roulette-engine";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { RouletteDatabase } from "../common/database.js";
import { bets, rounds } from "../db/schema.js";

export type RoundRow = typeof rounds.$inferSelect;
export type BetRow = typeof bets.$inferSelect;

/**
 * Rounds in Postgres, the record the engine resumes from. Every transition
 * is conditional on the expected status: the round id is the fencing token,
 * so an engine that lost the lease while paused changes nothing (ADR-012).
 */
@Injectable()
export class RoundRepository {
  constructor(@Inject(DATABASE) private readonly database: RouletteDatabase) {}

  private get db() {
    return this.database.db;
  }

  async latest(): Promise<RoundRow | null> {
    const [row] = await this.db
      .select()
      .from(rounds)
      .orderBy(desc(rounds.id))
      .limit(1);
    return row ?? null;
  }

  async find(id: number): Promise<RoundRow | null> {
    const [row] = await this.db.select().from(rounds).where(eq(rounds.id, id));
    return row ?? null;
  }

  /** Opens round `id`; false when it already exists (another engine got there). */
  async open(id: number, now: Date, timings: RoundTimings): Promise<boolean> {
    const rows = await this.db
      .insert(rounds)
      .values({
        id,
        status: "betting",
        openedAt: now,
        bettingEndsAt: new Date(now.getTime() + timings.bettingMs),
      })
      .onConflictDoNothing()
      .returning({ id: rounds.id });
    return rows.length > 0;
  }

  /**
   * Stops the round taking bets. The update waits for every bet batch that
   * holds the round row FOR SHARE, so after it no bet joins the round.
   */
  async lock(id: number, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(rounds)
      .set({ status: "locked", lockedAt: now })
      .where(and(eq(rounds.id, id), eq(rounds.status, "betting")))
      .returning({ id: rounds.id });
    return rows.length > 0;
  }

  async startRolling(
    id: number,
    result: { number: number; seed: string },
    rollingAt: Date,
    timings: RoundTimings,
  ): Promise<boolean> {
    const rows = await this.db
      .update(rounds)
      .set({
        status: "rolling",
        number: result.number,
        color: colorOf(result.number),
        seed: result.seed,
        rollingAt,
        settleAt: new Date(rollingAt.getTime() + timings.rollingMs),
      })
      .where(and(eq(rounds.id, id), eq(rounds.status, "locked")))
      .returning({ id: rounds.id });
    return rows.length > 0;
  }

  /** Bets of a round that are in the record. */
  async betsOf(roundId: number): Promise<BetRow[]> {
    return this.db.select().from(bets).where(eq(bets.roundId, roundId));
  }

  async findBet(id: string): Promise<BetRow | null> {
    const [row] = await this.db.select().from(bets).where(eq(bets.id, id));
    return row ?? null;
  }

  /** Which of these bets made it into the record. */
  async existing(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: bets.id })
      .from(bets)
      .where(inArray(bets.id, ids));
    return new Set(rows.map((row) => row.id));
  }

  /**
   * Marks winners and losers and closes the round in one transaction,
   * after the winnings are in the wallet. False when another engine did it.
   */
  async settle(
    id: number,
    color: Color,
    now: Date,
    timings: RoundTimings,
  ): Promise<boolean> {
    const multiplier = multipliers[color];
    return this.db.transaction(async (tx) => {
      const [closed] = await tx
        .update(rounds)
        .set({
          status: "settled",
          settledAt: now,
          nextRoundAt: new Date(now.getTime() + timings.settledMs),
        })
        .where(and(eq(rounds.id, id), eq(rounds.status, "rolling")))
        .returning({ id: rounds.id });
      if (!closed) return false;
      await tx
        .update(bets)
        .set({
          status: sql`case when ${bets.color} = ${color} then 'won' else 'lost' end`,
          payout: sql`case when ${bets.color} = ${color} then ${bets.amount} * ${multiplier} else 0 end`,
          settledAt: now,
        })
        .where(eq(bets.roundId, id));
      await tx
        .update(rounds)
        .set({
          bets: sql`(select count(*) from ${bets} where ${bets.roundId} = ${id})`,
          staked: sql`(select coalesce(sum(${bets.amount}), 0) from ${bets} where ${bets.roundId} = ${id})`,
          paidOut: sql`(select coalesce(sum(${bets.payout}), 0) from ${bets} where ${bets.roundId} = ${id})`,
        })
        .where(eq(rounds.id, id));
      return true;
    });
  }

  /** Settled rounds, newest first, before `before` when given. */
  async history(limit: number, before?: number) {
    return this.db
      .select({ round: rounds.id, number: rounds.number, color: rounds.color })
      .from(rounds)
      .where(
        and(
          eq(rounds.status, "settled"),
          before ? lt(rounds.id, before) : undefined,
        ),
      )
      .orderBy(desc(rounds.id))
      .limit(limit);
  }

  /** A player's bets in a round, oldest first. */
  async betsOfUser(roundId: number, userId: string): Promise<BetRow[]> {
    return this.db
      .select()
      .from(bets)
      .where(and(eq(bets.roundId, roundId), eq(bets.userId, userId)))
      .orderBy(bets.createdAt);
  }
}
