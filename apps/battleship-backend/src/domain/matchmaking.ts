/** A player waiting for a quick match. */
export type QueueEntry = {
  readonly userId: string;
  readonly rating: number;
  /** When the player joined, epoch ms (clock time). */
  readonly since: number;
};

export type SearchWindowOptions = {
  readonly initial: number;
  readonly step: number;
  readonly stepMs: number;
  readonly max: number;
  /** After this long anyone is acceptable. */
  readonly anyoneAfterMs: number;
};

/** ±100 at first, +50 every 5 s up to ±500, anyone after 30 s. */
export const defaultSearchWindow: SearchWindowOptions = {
  initial: 100,
  step: 50,
  stepMs: 5_000,
  max: 500,
  anyoneAfterMs: 30_000,
};

/** How far apart in rating a waiting player accepts an opponent. */
export class SearchWindow {
  constructor(private readonly options = defaultSearchWindow) {}

  width(waitedMs: number): number {
    const waited = Math.max(0, waitedMs);
    if (waited >= this.options.anyoneAfterMs) return Number.POSITIVE_INFINITY;
    const grown =
      this.options.initial +
      this.options.step * Math.floor(waited / this.options.stepMs);
    return Math.min(this.options.max, grown);
  }
}

/**
 * Pairs waiting players. The longest waiting goes first and takes the closest
 * rating that either player's window accepts, so someone waiting 30 s meets
 * even a newcomer. Pure: the queue store claims the pairs atomically.
 */
export class PairingPlanner {
  constructor(private readonly window = new SearchWindow()) {}

  plan(
    entries: readonly QueueEntry[],
    now: number,
  ): [QueueEntry, QueueEntry][] {
    const waiting = [...entries].sort(
      (a, b) => a.since - b.since || a.userId.localeCompare(b.userId),
    );
    const paired = new Set<string>();
    const pairs: [QueueEntry, QueueEntry][] = [];
    for (const player of waiting) {
      if (paired.has(player.userId)) continue;
      const reach = this.window.width(now - player.since);
      let best: QueueEntry | null = null;
      for (const other of waiting) {
        if (other.userId === player.userId || paired.has(other.userId))
          continue;
        const distance = Math.abs(other.rating - player.rating);
        const accepted = Math.max(reach, this.window.width(now - other.since));
        if (distance > accepted) continue;
        if (
          !best ||
          distance < Math.abs(best.rating - player.rating) ||
          (distance === Math.abs(best.rating - player.rating) &&
            other.since < best.since)
        ) {
          best = other;
        }
      }
      if (best) {
        paired.add(player.userId);
        paired.add(best.userId);
        pairs.push([player, best]);
      }
    }
    return pairs;
  }
}
