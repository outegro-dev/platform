import { Inject, Injectable } from "@nestjs/common";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, count, eq, gte, lt, ne, sql } from "drizzle-orm";
import type { EduDatabase, Executor } from "../common/database.js";
import { assistDays, type assistKinds, assistUsage } from "../db/schema.js";
import type { RelayResult } from "../domain/assist/relay.js";
import { utcDay } from "../domain/calendar.js";
import { mayWrite } from "../readers/account-lock.js";
import { AssistSettings } from "./settings.js";

const DAY_MS = 24 * 3600_000;

/** One request to the assistant: who asked, about what. */
export type AssistJob = {
  readonly kind: (typeof assistKinds)[number];
  readonly userId: string;
  readonly bookId: string;
  /** Chapter number. */
  readonly chapter: number;
};

/**
 * A request about to go to the model, counted against today's limits: its
 * usage row and the UTC day whose cap it took.
 */
export type Reservation = { readonly id: string; readonly day: string };

/**
 * Whether the provider could bill for the request: the reader got at least
 * part of the answer, or tokens were reported although nothing reached the
 * reader. A request the provider refused outright cost nothing.
 */
const billable = (
  result: Pick<RelayResult, "outcome" | "tokensIn" | "tokensOut">,
) =>
  result.outcome !== "refused" || result.tokensIn > 0 || result.tokensOut > 0;

/** 429 with the reason the client shows: today's answers are used up. */
export const dailyLimitReached = () =>
  new AppError("RATE_LIMITED", { fieldErrors: { assist: ["daily_limit"] } });

/**
 * 503 with the reason the client shows: the day's requests to the model of
 * all readers are spent, the assistant is paused until the next UTC day.
 * Not worth retrying today.
 */
export const assistPaused = () =>
  new AppError("DEPENDENCY_UNAVAILABLE", {
    fieldErrors: { assist: ["paused"] },
    retryable: false,
  });

/**
 * The assistant's usage rows and daily totals: the reader's daily limit, the
 * cap of all readers and the owner's bill. A request counts against the
 * reader's limit when it went to the model (not the cache) and the reader
 * got at least part of the answer (outcome `ok` or `failed`); against the
 * cap of all readers also when the provider billed tokens for it although
 * the reader got nothing (stopped while the model was thinking, broken off
 * before the first words). The reader's limit is counted from the reader's
 * rows, the cap from the day's total in `assist_days`, which a deleted
 * account's purge leaves alone. While an answer streams, it already counts
 * for both: concurrent requests cannot overrun either limit.
 */
@Injectable()
export class AssistLedger {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly settings: AssistSettings,
  ) {}

  /** Today's (UTC) requests that count against the reader's limit. */
  async usedToday(userId: string, db: Executor = this.database.db) {
    const [row] = await db
      .select({ value: count() })
      .from(assistUsage)
      .where(
        and(
          eq(assistUsage.userId, userId),
          eq(assistUsage.cached, false),
          ne(assistUsage.outcome, "refused"),
          this.today(),
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * Today's (UTC) requests to the model of all readers that count against
   * the cap: answered in full or in part, still streaming, or billed by the
   * provider (tokens) without a word for the reader, deleted accounts'
   * included. A request the provider refused outright cost nothing and is
   * not counted, so an outage of the provider does not pause the assistant
   * for the rest of the day.
   */
  async spentToday(db: Executor = this.database.db) {
    return this.spentOn(utcDay(this.clock.now()), db);
  }

  /**
   * 429 when the reader has no answers left today, 503 when the requests of
   * all readers are spent: a check before waiting for a model slot, made
   * again under the locks of `reserve`.
   */
  async requireQuota(userId: string): Promise<void> {
    if ((await this.usedToday(userId)) >= this.settings.dailyLimit)
      throw dailyLimitReached();
    const cap = this.settings.globalDailyLimit;
    if (cap > 0 && (await this.spentToday()) >= cap) throw assistPaused();
  }

  /**
   * Takes one of today's answers for a request about to go to the model:
   * checked and written under locks, so two requests at once cannot both
   * take the last answer of the reader (the reader's lock) or of the day
   * (the cap's lock, when there is a cap). Every request takes the cap's
   * lock before the reader's: one order, no deadlock. 403 when the account
   * was suspended or deleted after the request was checked. The reader's row
   * and the day's total count it from here on, until it is settled.
   */
  reserve(job: AssistJob): Promise<Reservation> {
    return this.database.db.transaction(async (tx) => {
      const cap = this.settings.globalDailyLimit;
      if (cap > 0)
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('edu.assist.global'))`,
        );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('edu.assist.' || ${job.userId}::text))`,
      );
      if (!(await mayWrite(tx, job.userId))) throw new AppError("FORBIDDEN");
      if ((await this.usedToday(job.userId, tx)) >= this.settings.dailyLimit)
        throw dailyLimitReached();
      const at = this.clock.now();
      const day = utcDay(at);
      if (cap > 0 && (await this.spentOn(day, tx)) >= cap) throw assistPaused();
      const [row] = await tx
        .insert(assistUsage)
        .values({
          ...job,
          cached: false,
          // Until settled: counted, and failed if the pod dies meanwhile.
          outcome: "failed",
          at,
        })
        .returning({ id: assistUsage.id });
      if (!row) throw new Error("assist usage row was not written");
      await tx
        .insert(assistDays)
        .values({ day, spent: 1 })
        .onConflictDoUpdate({
          target: assistDays.day,
          set: { spent: sql`${assistDays.spent} + 1` },
        });
      return { id: row.id, day };
    });
  }

  /**
   * How the reserved request ended and what it cost. An update of the row
   * the reservation wrote, never a new one: when the account was purged
   * meanwhile, the row is gone and nothing is written to it. A request the
   * provider refused outright gives its place in the cap back, on the day
   * it was reserved, whether the row is still there or not.
   */
  async settle(
    reservation: Reservation,
    result: Pick<RelayResult, "outcome" | "tokensIn" | "tokensOut">,
  ): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(assistUsage)
        .set({
          outcome: result.outcome,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        })
        .where(eq(assistUsage.id, reservation.id));
      if (!billable(result))
        await tx
          .update(assistDays)
          .set({ spent: sql`${assistDays.spent} - 1` })
          .where(eq(assistDays.day, reservation.day));
    });
  }

  /**
   * A request served from the cache: on the record, never counted; not
   * recorded once the account is no longer active.
   */
  async recordCached(job: AssistJob): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      if (!(await mayWrite(tx, job.userId))) return;
      await tx.insert(assistUsage).values({
        ...job,
        cached: true,
        outcome: "ok",
        at: this.clock.now(),
      });
    });
  }

  /** The day's requests counted against the cap of all readers. */
  private async spentOn(day: string, db: Executor) {
    const [row] = await db
      .select({ spent: assistDays.spent })
      .from(assistDays)
      .where(eq(assistDays.day, day));
    return row?.spent ?? 0;
  }

  /** Rows of the current UTC day. */
  private today() {
    const start = new Date(`${utcDay(this.clock.now())}T00:00:00.000Z`);
    return and(
      gte(assistUsage.at, start),
      lt(assistUsage.at, new Date(start.getTime() + DAY_MS)),
    );
  }
}
