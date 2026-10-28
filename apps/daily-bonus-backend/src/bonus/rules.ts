import { randomInt } from "node:crypto";
import type { DailyPrize } from "@outegro/contracts/daily-bonus";

/** The next bonus opens 24 hours after the last one was taken. */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** A streak holds if the next bonus is taken within 48 hours of the last. */
export const STREAK_WINDOW_MS = 48 * 60 * 60 * 1000;
/** +10 % a day in a row, up to +60 % from the seventh day. */
export const STREAK_STEP_PERCENT = 10;
export const STREAK_MAX_PERCENT = 60;
/** Bonuses one network or one device may take in 24 hours, over all accounts. */
export const CLAIMS_PER_IP = 3;
export const CLAIMS_PER_DEVICE = 3;
/** New accounts wait this long before their first bonus. */
export const MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

/** The plan's table: 143.25 grumbles on average (owner, 28.10.2026). */
export const defaultPrizes: DailyPrize[] = [
  { amount: 25, chance: 0.35 },
  { amount: 50, chance: 0.28 },
  { amount: 100, chance: 0.18 },
  { amount: 250, chance: 0.11 },
  { amount: 500, chance: 0.05 },
  { amount: 1000, chance: 0.025 },
  { amount: 5000, chance: 0.005 },
];

export const cryptoRandom = () => randomInt(0, 2 ** 48) / 2 ** 48;

/** The average prize of a table, before streak bonuses. */
export function expectedPrize(prizes: readonly DailyPrize[]): number {
  return prizes.reduce((sum, prize) => sum + prize.amount * prize.chance, 0);
}

/** The line a uniform draw in [0, 1) lands on. */
export function drawPrize(
  prizes: readonly DailyPrize[],
  random: () => number,
): number {
  const total = prizes.reduce((sum, prize) => sum + prize.chance, 0);
  let point = random() * total;
  for (const [index, prize] of prizes.entries()) {
    point -= prize.chance;
    if (point < 0) return index;
  }
  return prizes.length - 1;
}

/** The streak a claim at `now` continues, given the last claim. */
export function nextStreak(
  last: { claimedAt: Date; streak: number } | null,
  now: Date,
  streaksEnabled: boolean,
): number {
  if (!streaksEnabled || !last) return 1;
  return now.getTime() - last.claimedAt.getTime() <= STREAK_WINDOW_MS
    ? last.streak + 1
    : 1;
}

/** Day 1 adds nothing, day 2 adds 10 %, … day 7 and later add 60 %. */
export function streakBonusPercent(streak: number, streaksEnabled: boolean) {
  if (!streaksEnabled || streak <= 1) return 0;
  return Math.min((streak - 1) * STREAK_STEP_PERCENT, STREAK_MAX_PERCENT);
}

export function withStreak(basePrize: number, percent: number): number {
  return basePrize + Math.round((basePrize * percent) / 100);
}
