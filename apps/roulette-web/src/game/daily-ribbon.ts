import type { DailyPrize } from "@outegro/contracts/daily-bonus";

/** Tiles on the prize ribbon, and the one it stops on. */
export const RIBBON_TILES = 56;
export const RIBBON_WIN_AT = 46;

/** mulberry32: a small deterministic generator for the ribbon's filler. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(prizes: DailyPrize[], roll: number): number {
  let left = roll * prizes.reduce((sum, prize) => sum + prize.chance, 0);
  for (let i = 0; i < prizes.length; i++) {
    left -= prizes[i]?.chance ?? 0;
    if (left < 0) return i;
  }
  return prizes.length - 1;
}

/**
 * The ribbon of the bonus box: indexes into `prizes`. The server picked the
 * prize; the ribbon only shows it. The other tiles are drawn with the
 * table's own chances from a seed (the claim number), so the ribbon looks
 * like the odds really are, and nothing places a big prize next to the
 * stop on purpose. `within` is where in the winning tile the marker stops.
 */
export function prizeRibbon(
  prizes: DailyPrize[],
  prizeIndex: number,
  seed: number,
): { tiles: number[]; winAt: number; within: number } {
  if (prizes.length === 0) return { tiles: [], winAt: 0, within: 0.5 };
  const random = generator(seed);
  const tiles = Array.from({ length: RIBBON_TILES }, () =>
    pick(prizes, random()),
  );
  const index = Math.min(Math.max(0, prizeIndex), prizes.length - 1);
  tiles[RIBBON_WIN_AT] = index;
  return { tiles, winAt: RIBBON_WIN_AT, within: 0.25 + random() * 0.5 };
}

/** "05:12:33" until a moment; "00:00:00" once it has passed. */
export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
