import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from "@nestjs/common";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import type { Color } from "@outegro/roulette-engine";
import { eq, inArray } from "drizzle-orm";
import type { RouletteDatabase } from "../common/database.js";
import { bets, rounds } from "../db/schema.js";

/** How long a bet waits for company before its batch is written. */
export const FLUSH_EVERY_MS = 5;
const MAX_BATCH = 500;

export type NewBet = {
  id: string;
  roundId: number;
  userId: string;
  clientBetId: string;
  color: Color;
  amount: number;
};

/** accepted: the bet is in the record; closed: the round stopped first. */
export type WriteOutcome = "accepted" | "closed";

type Waiting = {
  bet: NewBet;
  resolve: (outcome: WriteOutcome) => void;
  reject: (error: unknown) => void;
};

/**
 * Writes accepted bets in batches every 5 ms (ADR-012): one transaction per
 * round holds the round row FOR SHARE and inserts only while it still takes
 * bets, so the close (an UPDATE of that row) waits for the batch and nothing
 * joins the round afterwards. The player hears back after the commit.
 */
@Injectable()
export class BetWriter implements OnModuleDestroy {
  private readonly logger = new Logger("BetWriter");
  private queue: Waiting[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DATABASE) private readonly database: RouletteDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  write(bet: NewBet): Promise<WriteOutcome> {
    return new Promise((resolve, reject) => {
      this.queue.push({ bet, resolve, reject });
      if (this.queue.length >= MAX_BATCH) this.schedule(0);
      else this.schedule(FLUSH_EVERY_MS);
    });
  }

  async onModuleDestroy() {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.drain();
  }

  private schedule(delayMs: number) {
    if (this.timer && delayMs > 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.drain();
    }, delayMs);
  }

  /** Batches run one after another, in arrival order. */
  private drain(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, MAX_BATCH);
        await this.flush(batch);
      }
    });
    return this.flushing;
  }

  private async flush(batch: Waiting[]) {
    const byRound = new Map<number, Waiting[]>();
    for (const waiting of batch) {
      const list = byRound.get(waiting.bet.roundId) ?? [];
      list.push(waiting);
      byRound.set(waiting.bet.roundId, list);
    }
    for (const [roundId, group] of byRound) {
      try {
        const outcomes = await this.writeRound(
          roundId,
          group.map((waiting) => waiting.bet),
        );
        for (const waiting of group)
          waiting.resolve(outcomes.get(waiting.bet.id) ?? "closed");
      } catch (error) {
        this.logger.error(
          { roundId, bets: group.length, err: (error as Error).message },
          "Bet batch failed",
        );
        for (const waiting of group) waiting.reject(error);
      }
    }
  }

  private writeRound(
    roundId: number,
    list: NewBet[],
  ): Promise<Map<string, WriteOutcome>> {
    return this.database.db.transaction(async (tx) => {
      const [round] = await tx
        .select({ status: rounds.status })
        .from(rounds)
        .where(eq(rounds.id, roundId))
        .for("share");
      const ids = list.map((bet) => bet.id);
      // A repeat of a bet already in the record is accepted, whatever the phase.
      const present = new Set(
        (
          await tx
            .select({ id: bets.id })
            .from(bets)
            .where(inArray(bets.id, ids))
        ).map((row) => row.id),
      );
      const outcomes = new Map<string, WriteOutcome>();
      const fresh = new Map<string, NewBet>();
      for (const bet of list) {
        if (present.has(bet.id)) outcomes.set(bet.id, "accepted");
        else if (round?.status === "betting") fresh.set(bet.id, bet);
        else outcomes.set(bet.id, "closed");
      }
      if (fresh.size > 0) {
        const now = this.clock.now();
        await tx
          .insert(bets)
          .values(
            [...fresh.values()].map((bet) => ({ ...bet, createdAt: now })),
          )
          .onConflictDoNothing();
        for (const id of fresh.keys()) outcomes.set(id, "accepted");
      }
      return outcomes;
    });
  }
}
