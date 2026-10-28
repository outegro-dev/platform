import { describe, expect, it } from "vitest";
import { checkFair, normalizeSeed, validFairInput } from "./fair-check";

// The control chain of the Rust prototype: root 32 × 0x01, 1 000 000 links.
const COMMIT =
  "2158ee1c7e99c2a02b2939500b971df4513cc0837bbec0bda2e29f7d2e3d1cd0";
const SEED_1 =
  "ca993cd75e481b9433ea7edcac03172888243cc4cb2cbd8643f185174db13125";

describe("checkFair", () => {
  it("confirms the control round: link to the commit, number 8, black", async () => {
    const outcome = await checkFair({
      seed: SEED_1,
      previousSeed: COMMIT,
      publicSeed: "drand:1234567",
      round: 1,
      published: 8,
    });
    expect(outcome).toEqual({
      linkOk: true,
      number: 8,
      color: "black",
      matches: true,
    });
  });

  it("catches a wrong link and a wrong published number", async () => {
    const outcome = await checkFair({
      seed: SEED_1,
      previousSeed: "0".repeat(64),
      publicSeed: "drand:1234567",
      round: 1,
      published: 3,
    });
    expect(outcome.linkOk).toBe(false);
    expect(outcome.matches).toBe(false);
  });

  it("recomputes the number without a previous seed or a published result", async () => {
    const outcome = await checkFair({
      seed: SEED_1,
      previousSeed: null,
      publicSeed: "drand:1234567",
      round: 1,
    });
    expect(outcome).toEqual({
      linkOk: null,
      number: 8,
      color: "black",
      matches: null,
    });
  });

  it("validates and normalizes what was pasted", () => {
    expect(normalizeSeed(` 0x${SEED_1.toUpperCase()} `)).toBe(SEED_1);
    expect(
      validFairInput({
        seed: SEED_1,
        previousSeed: null,
        publicSeed: "x",
        round: 1,
      }),
    ).toBe(true);
    expect(
      validFairInput({
        seed: "abc",
        previousSeed: null,
        publicSeed: "x",
        round: 1,
      }),
    ).toBe(false);
    expect(
      validFairInput({
        seed: SEED_1,
        previousSeed: null,
        publicSeed: "x",
        round: 0,
      }),
    ).toBe(false);
  });
});
