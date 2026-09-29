/** Source of randomness; injected so that placement and bots are reproducible in tests. */
export interface Random {
  /** A float in [0, 1). */
  next(): number;
}

/** Deterministic generator (mulberry32) for tests, replays and seeded bots. */
export class SeededRandom implements Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** Platform randomness for production games. */
export class MathRandom implements Random {
  next(): number {
    return Math.random();
  }
}

/** An integer in [0, max). */
export function randomInt(random: Random, max: number): number {
  return Math.floor(random.next() * max);
}

/** One element of a non-empty list. */
export function pick<T>(random: Random, items: readonly T[]): T {
  if (items.length === 0)
    throw new RangeError("Cannot pick from an empty list");
  return items[randomInt(random, items.length)] as T;
}
