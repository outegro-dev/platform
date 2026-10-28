/** The colours a player bets on. */
export const colors = ["red", "black", "green"] as const;
export type Color = (typeof colors)[number];

/** Numbers 0..14: 0 is green, 1..7 red, 8..14 black. */
export const SECTORS = 15;

export function colorOf(number: number): Color {
  if (!Number.isInteger(number) || number < 0 || number >= SECTORS)
    throw new RangeError(`not a sector: ${number}`);
  if (number === 0) return "green";
  return number <= 7 ? "red" : "black";
}

/**
 * Payout multipliers, the stake included. Every bet returns 14/15 on average
 * (7/15 × 2 = 1/15 × 14), so the house keeps 1/15 without touching outcomes.
 * Changing them changes the RTP: that needs a new ADR, not a setting.
 */
export const multipliers: Readonly<Record<Color, number>> = {
  red: 2,
  black: 2,
  green: 14,
};

/** What a bet returns once the number is known: 0 when it loses. */
export function payoutOf(
  bet: { color: Color; amount: number },
  number: number,
) {
  return colorOf(number) === bet.color
    ? bet.amount * multipliers[bet.color]
    : 0;
}

/**
 * The order of tiles on the strip, repeated: colours alternate and green sits
 * between red 4 and black 11.
 */
export const stripOrder: readonly number[] = [
  1, 14, 2, 13, 3, 12, 4, 0, 11, 5, 10, 6, 9, 7, 8,
];

/** The expected return of every bet, 14/15. */
export const returnToPlayer = 14 / 15;
