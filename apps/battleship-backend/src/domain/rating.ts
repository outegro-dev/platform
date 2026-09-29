import {
  type EloOptions,
  EloRating,
  type RatedPlayer,
} from "@outegro/battleship-engine";

export type MatchMode = "bot" | "quick" | "private";

/** §16.3: start 1000, K = 32, K = 16 after 30 rated matches. */
export const STARTING_RATING = 1000;
export const eloOptions: EloOptions = {
  provisionalMatches: 30,
  provisionalK: 32,
  establishedK: 16,
};

export type RatingChange = {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
};

/**
 * Only quick matches move the rating (§16.3); private rooms and bots never do.
 * The exchange is zero-sum: the winner gains exactly what the loser loses
 * (TC-BS-07).
 */
export class RatingPolicy {
  constructor(private readonly elo = new EloRating(eloOptions)) {}

  /** Fewer than 30 rated matches: K = 32. */
  isProvisional(ratedMatches: number): boolean {
    return ratedMatches < eloOptions.provisionalMatches;
  }

  isRated(mode: MatchMode): boolean {
    return mode === "quick";
  }

  settle(
    winner: RatedPlayer,
    loser: RatedPlayer,
  ): { winner: RatingChange; loser: RatingChange } {
    const points = this.elo.exchange(winner, loser);
    return {
      winner: {
        before: winner.rating,
        after: winner.rating + points,
        delta: points,
      },
      loser: {
        before: loser.rating,
        after: loser.rating - points,
        delta: -points,
      },
    };
  }
}
