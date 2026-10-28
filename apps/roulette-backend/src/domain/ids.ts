import { createHash, randomInt } from "node:crypto";

/**
 * The bet id for a user's `clientBetId`: a UUID-shaped SHA-256 of both, so
 * a double click or a retry after a timeout lands on the same bet and the
 * same wallet ref, and two users can never collide.
 */
export function betIdOf(userId: string, clientBetId: string): string {
  const hex = createHash("sha256")
    .update(`roulette:bet:${userId}:${clientBetId}`)
    .digest("hex");
  // Version 8 (custom) and the RFC 9562 variant, so it passes as a UUID.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `8${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/** Wallet refs (ADR-012): unique in the wallet, so every retry is idempotent. */
export const betRef = (betId: string) => `roulette:bet:${betId}`;
export const winRef = (betId: string) => `roulette:win:${betId}`;

/** Nickname of accounts deleted in Identity (never unique). */
export const deletedNickname = "Deleted player";

/**
 * Default nickname "Player NNNN"; after a few collisions the number grows so
 * a crowded range cannot block new players.
 */
export function defaultNickname(
  attempt: number,
  random: (max: number) => number = randomInt,
): string {
  const digits = attempt < 5 ? 4 : attempt < 10 ? 6 : 8;
  const low = 10 ** (digits - 1);
  return `Player ${low + random(9 * low)}`;
}
