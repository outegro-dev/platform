import { type Color, multipliers } from "./wheel.js";

/** Phases of a round, in order. */
export const phases = ["betting", "locked", "rolling", "settled"] as const;
export type Phase = (typeof phases)[number];

/** How long each phase lasts: 20 s bets, 1 s close, 6 s spin, 3 s payouts. */
export type RoundTimings = {
  bettingMs: number;
  lockedMs: number;
  rollingMs: number;
  settledMs: number;
};

export const defaultTimings: RoundTimings = {
  bettingMs: 20_000,
  lockedMs: 1_000,
  rollingMs: 6_000,
  settledMs: 3_000,
};

/** Table limits (owner, 28.10.2026); configuration, not code. */
export type TableLimits = {
  minBet: number;
  maxBet: number;
  betsPerRound: number;
  /** The most one colour may pay out in a round, stakes included. */
  payoutLimitPerColor: number;
};

export const defaultLimits: TableLimits = {
  minBet: 10,
  maxBet: 100_000,
  betsPerRound: 3,
  payoutLimitPerColor: 1_000_000,
};

/** Why a stake is refused before it reaches the wallet. */
export type StakeProblem = "bet_too_small" | "bet_too_large";

export function checkStake(
  amount: number,
  limits: TableLimits,
): StakeProblem | null {
  if (!Number.isSafeInteger(amount) || amount < limits.minBet)
    return "bet_too_small";
  if (amount > limits.maxBet) return "bet_too_large";
  return null;
}

/** What a bet adds to its colour's exposure: the payout if that colour wins. */
export function exposureOf(color: Color, amount: number) {
  return amount * multipliers[color];
}
