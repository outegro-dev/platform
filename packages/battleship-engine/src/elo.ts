export type RatedPlayer = {
  readonly rating: number;
  /** Rated matches played before this one. */
  readonly matches: number;
};

export type EloOptions = {
  readonly provisionalMatches: number;
  readonly provisionalK: number;
  readonly establishedK: number;
};

const defaults: EloOptions = {
  provisionalMatches: 30,
  provisionalK: 32,
  establishedK: 16,
};

/**
 * Elo for quick matches (§16.3). One K per match — 32 while either player is
 * provisional, 16 after — so the exchange is zero-sum (TC-BS-07).
 */
export class EloRating {
  constructor(private readonly options: EloOptions = defaults) {}

  /** Points the winner gains and the loser loses. */
  exchange(winner: RatedPlayer, loser: RatedPlayer): number {
    const expected = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
    const k =
      winner.matches < this.options.provisionalMatches ||
      loser.matches < this.options.provisionalMatches
        ? this.options.provisionalK
        : this.options.establishedK;
    return Math.max(1, Math.round(k * (1 - expected)));
  }
}
