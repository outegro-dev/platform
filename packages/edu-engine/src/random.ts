/** Source of randomness; injected so that shuffles are reproducible in tests. */
export interface Random {
  /** A float in [0, 1). */
  next(): number;
}

/** Deterministic generator (mulberry32) for tests and server-rendered shuffles. */
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

/** Platform randomness: "try again" reshuffles. */
export class MathRandom implements Random {
  next(): number {
    return Math.random();
  }
}

/**
 * A stable seed from text (32-bit FNV-1a): an exercise id seeds its first
 * shuffle, so the server render and the browser agree on it.
 */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random.next() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

/**
 * Positions 0…n-1 shuffled and never already in order (for n > 1), so an
 * order exercise never starts solved.
 */
export function shuffledIndices(count: number, random: Random): number[] {
  const indices = shuffle(
    Array.from({ length: count }, (_, i) => i),
    random,
  );
  if (count > 1 && indices.every((value, i) => value === i)) indices.reverse();
  return indices;
}
