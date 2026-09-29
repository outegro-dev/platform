import { randomInt } from "node:crypto";

/** Characters of `roomCodeSchema`: no look-alikes (0/O, 1/I). */
export const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const roomCodeLength = 6;

/** Unguessable private room code (32^6 ≈ 10^9 combinations). */
export function generateRoomCode(random: (max: number) => number = randomInt) {
  let code = "";
  for (let i = 0; i < roomCodeLength; i++)
    code += roomCodeAlphabet[random(roomCodeAlphabet.length)];
  return code;
}

/** Nickname of accounts deleted in Identity (never unique). */
export const deletedNickname = "Deleted player";

/**
 * Default nickname "Sailor NNNN"; after a few collisions the number grows so
 * a crowded range cannot block sign-ups.
 */
export function defaultNickname(
  attempt: number,
  random: (max: number) => number = randomInt,
): string {
  const digits = attempt < 5 ? 4 : attempt < 10 ? 6 : 8;
  const low = 10 ** (digits - 1);
  return `Sailor ${low + random(9 * low)}`;
}
