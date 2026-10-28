import type { DailyPrize } from "@outegro/contracts/daily-bonus";
import type { RoundView, TableSettings } from "@outegro/contracts/roulette";

/**
 * Roulette in the console's terms: colours in the table's order, the payout
 * exposure against its limit, the time left in a phase, what a table change
 * changes, the prize table of the bonus of the day and where an audit entry
 * points. Pure functions, shared by server pages and client forms; only
 * types come from the contract, so the forms do not ship its schemas (the
 * lists below are checked against the contract by the tests).
 */

/** Grumbles (GRM): the platform's currency, the roulette's stakes. */
export const grm = "GRM";
export const rouletteColors = ["red", "black", "green"] as const;
export type RouletteColor = (typeof rouletteColors)[number];
export const roulettePhases = [
  "betting",
  "locked",
  "rolling",
  "settled",
  "voided",
] as const;
export type RoulettePhase = (typeof roulettePhases)[number];

/** Over this share of the payout limit a colour is "close to the limit". */
export const NEAR_LIMIT = 0.8;

export type Exposure = {
  color: RouletteColor;
  /** What the colour would pay if it won now. */
  amount: number;
  /** amount / limit (0 without a limit). */
  ratio: number;
  near: boolean;
  /** At or past the limit: the table refuses more on this colour. */
  full: boolean;
};

export function exposureOf(
  exposure: Record<RouletteColor, number>,
  limit: number,
): Exposure[] {
  return rouletteColors.map((color) => {
    const amount = exposure[color];
    const ratio = limit > 0 ? amount / limit : 0;
    return {
      color,
      amount,
      ratio,
      near: ratio > NEAR_LIMIT,
      full: limit > 0 && amount >= limit,
    };
  });
}

/** Bets and grumbles on the table in this round, over every colour. */
export function roundTotals(round: Pick<RoundView, "totals">): {
  count: number;
  sum: number;
} {
  return rouletteColors.reduce(
    (total, color) => ({
      count: total.count + round.totals[color].count,
      sum: total.sum + round.totals[color].sum,
    }),
    { count: 0, sum: 0 },
  );
}

/** When the current phase ends (the next round starts after settled/voided). */
export function phaseEndsAt(
  round: Pick<
    RoundView,
    "phase" | "bettingEndsAt" | "rollingAt" | "settleAt" | "nextRoundAt"
  >,
): string | null {
  switch (round.phase) {
    case "betting":
      return round.bettingEndsAt;
    case "locked":
      return round.rollingAt;
    case "rolling":
      return round.settleAt;
    default:
      return round.nextRoundAt;
  }
}

/** Whole seconds left until `at` (never negative); null without a time. */
export function secondsUntil(at: string | null, now: number): number | null {
  if (!at) return null;
  const time = Date.parse(at);
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.ceil((time - now) / 1000));
}

/** A round can be voided until it is paid out (or voided already). */
export const isVoidable = (phase: RoulettePhase) =>
  phase !== "settled" && phase !== "voided";

/** The table settings an operator changes, in the form's order. */
export const tableFields = [
  "minBet",
  "maxBet",
  "betsPerRound",
  "payoutLimitPerColor",
  "paused",
  "maintenance",
] as const;
export type TableField = (typeof tableFields)[number];

export type FieldChange = {
  field: TableField;
  before: number | boolean;
  after: number | boolean;
};

/** What a table command changes; empty when it changes nothing. */
export function tableDiff(
  before: Pick<TableSettings, TableField>,
  after: Pick<TableSettings, TableField>,
): FieldChange[] {
  return tableFields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
}

/** The average prize of a table, before streak bonuses. */
export function expectedPrize(prizes: readonly DailyPrize[]): number {
  return prizes.reduce((sum, prize) => sum + prize.amount * prize.chance, 0);
}

export function chanceSum(prizes: readonly { chance: number }[]): number {
  return prizes.reduce((sum, prize) => sum + prize.chance, 0);
}

/** The contract's own rule: chances of a table sum to 1. */
export const chancesSumToOne = (prizes: readonly { chance: number }[]) =>
  Math.abs(chanceSum(prizes) - 1) < 1e-9;

/** A row of the prize editor, as typed: an amount and a chance in percent. */
export type PrizeRow = { amount: string; percent: string };

export const rowsOf = (prizes: readonly DailyPrize[]): PrizeRow[] =>
  prizes.map((prize) => ({
    amount: String(prize.amount),
    // 0.1 → "10", not "10.000000000000002".
    percent: String(Number((prize.chance * 100).toPrecision(12))),
  }));

export type PrizeTable =
  | { ok: true; prizes: DailyPrize[] }
  | {
      ok: false;
      problem: "empty" | "too-many" | "amount" | "chance" | "sum";
    };

/** The typed rows as the contract's table, or what is wrong with them. */
export function prizeTableOf(rows: readonly PrizeRow[]): PrizeTable {
  if (rows.length === 0) return { ok: false, problem: "empty" };
  if (rows.length > 20) return { ok: false, problem: "too-many" };
  const prizes: DailyPrize[] = [];
  for (const row of rows) {
    const amount = Number(row.amount.trim());
    if (!row.amount.trim() || !Number.isInteger(amount) || amount <= 0)
      return { ok: false, problem: "amount" };
    const percent = Number(row.percent.trim().replace(",", "."));
    if (!row.percent.trim() || !Number.isFinite(percent))
      return { ok: false, problem: "chance" };
    const chance = percent / 100;
    if (chance <= 0 || chance > 1) return { ok: false, problem: "chance" };
    prizes.push({ amount, chance });
  }
  if (!chancesSumToOne(prizes)) return { ok: false, problem: "sum" };
  return { ok: true, prizes };
}

/** Same lines in the same order: the table did not change. */
export const samePrizes = (
  a: readonly DailyPrize[],
  b: readonly DailyPrize[],
) =>
  a.length === b.length &&
  a.every(
    (prize, index) =>
      prize.amount === b[index]?.amount && prize.chance === b[index]?.chance,
  );

/**
 * Where a roulette audit entry points: `round:184` is a round with a page,
 * `table` the table's settings; anything else is shown as the service
 * wrote it.
 */
export function auditTargetOf(subject: string): {
  targetType: string;
  targetId: string;
} {
  const round = /^round:(\d+)$/.exec(subject);
  if (round?.[1]) return { targetType: "round", targetId: round[1] };
  if (subject === "table" || subject === "daily")
    return { targetType: "settings", targetId: subject };
  const at = subject.indexOf(":");
  return at > 0
    ? { targetType: subject.slice(0, at), targetId: subject.slice(at + 1) }
    : { targetType: "subject", targetId: subject };
}

/** A round number from the URL; null for anything else. */
export function roundParam(value: string): number | null {
  if (!/^\d{1,12}$/.test(value)) return null;
  const round = Number(value);
  return Number.isSafeInteger(round) && round > 0 ? round : null;
}
