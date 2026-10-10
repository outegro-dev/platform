/*
 * Seeded randomness for the crooked look: the same text always gets the same
 * letters, tilts and bars, so server and client render identical markup.
 */

export function seed(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny deterministic generator, 0 ≤ x < 1. */
export function generator(start: number) {
  let a = start;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(next: () => number, list: readonly T[]) =>
  list[Math.floor(next() * list.length)];

/** A tilt in degrees within ±max, rounded so the markup stays short. */
export const tilt = (next: () => number, max: number) =>
  Math.round((next() * 2 - 1) * max * 10) / 10;
