import {
  type Color,
  colorOf,
  isSeedHex,
  roll,
  verifyLink,
} from "@outegro/roulette-engine";

export type FairInput = {
  /** The round's revealed seed. */
  seed: string;
  /** The previous round's seed (seed₀ for round 1); null when unknown. */
  previousSeed: string | null;
  publicSeed: string;
  round: number;
  /** The number the round showed, to compare with. */
  published?: number | null;
};

export type FairOutcome = {
  /** SHA-256(seed) = previous seed; null when there was nothing to compare with. */
  linkOk: boolean | null;
  number: number;
  color: Color;
  /** The recomputed number equals the published one; null without one. */
  matches: boolean | null;
};

/** Whether the input can be checked at all. */
export function validFairInput(input: FairInput): boolean {
  return (
    isSeedHex(input.seed) &&
    (input.previousSeed === null || isSeedHex(input.previousSeed)) &&
    input.publicSeed.length > 0 &&
    Number.isSafeInteger(input.round) &&
    input.round >= 1
  );
}

/**
 * The whole check of /fair, in the browser (WebCrypto): the seed is the next
 * link of the published chain, and the number follows from it.
 */
export async function checkFair(input: FairInput): Promise<FairOutcome> {
  const linkOk =
    input.previousSeed === null
      ? null
      : await verifyLink(input.previousSeed, input.seed);
  const number = await roll(input.seed, input.publicSeed, input.round);
  return {
    linkOk,
    number,
    color: colorOf(number),
    matches:
      input.published === undefined || input.published === null
        ? null
        : input.published === number,
  };
}

/** Lowercase, no spaces: seeds pasted from anywhere. */
export function normalizeSeed(text: string): string {
  return text.trim().toLowerCase().replace(/^0x/, "");
}
