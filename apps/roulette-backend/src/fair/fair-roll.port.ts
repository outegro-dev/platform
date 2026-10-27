import type { FairInfo, FairReveal } from "@outegro/contracts/roulette";

/**
 * fair-roll as the engine sees it: the published chain and the reveal of
 * the next round. The engine never holds the root and never picks a number.
 */
export interface FairRollPort {
  chain(): Promise<FairInfo>;
  /** Strictly in order; a repeat of the last round returns the same seed. */
  reveal(round: number): Promise<FairReveal>;
}

export class FairRollError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
