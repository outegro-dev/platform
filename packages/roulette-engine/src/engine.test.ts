import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkStake,
  colorOf,
  defaultLimits,
  exposureOf,
  payoutOf,
  returnToPlayer,
  roll,
  SECTORS,
  stopOffset,
  stripOrder,
  verifyLink,
} from "./index.js";

/** seed[0..len] for a root: seed[len] = root, seed[i - 1] = SHA-256(seed[i]). */
function chain(root: Buffer, length: number): string[] {
  const seeds = new Array<string>(length + 1);
  let link = root;
  seeds[length] = link.toString("hex");
  for (let i = length - 1; i >= 0; i--) {
    link = createHash("sha256").update(link).digest();
    seeds[i] = link.toString("hex");
  }
  return seeds;
}

describe("wheel", () => {
  it("colours 0 green, 1..7 red, 8..14 black", () => {
    expect(colorOf(0)).toBe("green");
    expect(colorOf(1)).toBe("red");
    expect(colorOf(7)).toBe("red");
    expect(colorOf(8)).toBe("black");
    expect(colorOf(14)).toBe("black");
    expect(() => colorOf(15)).toThrow(RangeError);
  });

  it("pays ×2 / ×2 / ×14 and returns 14/15 on every colour", () => {
    expect(payoutOf({ color: "red", amount: 50 }, 3)).toBe(100);
    expect(payoutOf({ color: "black", amount: 50 }, 3)).toBe(0);
    expect(payoutOf({ color: "green", amount: 10 }, 0)).toBe(140);
    for (const color of ["red", "black", "green"] as const) {
      let returned = 0;
      for (let n = 0; n < SECTORS; n++)
        returned += payoutOf({ color, amount: 1 }, n);
      expect(returned / SECTORS).toBeCloseTo(returnToPlayer, 10);
    }
  });

  it("puts every number on the strip once", () => {
    expect([...stripOrder].sort((a, b) => a - b)).toEqual(
      Array.from({ length: SECTORS }, (_, n) => n),
    );
  });

  it("checks stakes and exposure against the table", () => {
    expect(checkStake(9, defaultLimits)).toBe("bet_too_small");
    expect(checkStake(10.5, defaultLimits)).toBe("bet_too_small");
    expect(checkStake(10, defaultLimits)).toBeNull();
    expect(checkStake(100_000, defaultLimits)).toBeNull();
    expect(checkStake(100_001, defaultLimits)).toBe("bet_too_large");
    expect(exposureOf("green", 1000)).toBe(14_000);
  });
});

describe("fair roll", () => {
  it("matches the Rust prototype: root 32 × 0x01, chain 1 000 000, round 1 → 8", async () => {
    const seeds = chain(Buffer.alloc(32, 1), 1_000_000);
    const [seed0, seed1] = seeds as [string, string];
    expect(seed1.startsWith("ca993cd7")).toBe(true);
    expect(seed1.endsWith("4db13125")).toBe(true);
    expect(await verifyLink(seed0, seed1)).toBe(true);
    expect(await roll(seed1, "drand:1234567", 1)).toBe(8);
    expect(colorOf(8)).toBe("black");
  });

  it("verifies links only in order", async () => {
    const seeds = chain(Buffer.alloc(32, 7), 10);
    for (let k = 1; k <= 10; k++)
      expect(await verifyLink(seeds[k - 1] ?? "", seeds[k] ?? "")).toBe(true);
    expect(await verifyLink(seeds[0] ?? "", seeds[2] ?? "")).toBe(false);
    expect(await verifyLink("zz", seeds[1] ?? "")).toBe(false);
  });

  it("gives every number the same share over 150 000 rounds", async () => {
    const rounds = 150_000;
    const seeds = chain(Buffer.alloc(32, 42), rounds);
    const counts = new Array<number>(SECTORS).fill(0);
    // In batches: WebCrypto works on the thread pool, and one await at a time
    // takes minutes on a CI runner.
    const batch = 5_000;
    for (let from = 1; from <= rounds; from += batch) {
      const size = Math.min(batch, rounds - from + 1);
      const numbers = await Promise.all(
        Array.from({ length: size }, (_, i) =>
          roll(seeds[from + i] ?? "", "drand:1234567", from + i),
        ),
      );
      for (const n of numbers) counts[n] = (counts[n] ?? 0) + 1;
    }
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(9_500);
    for (const count of counts) expect(count).toBeLessThanOrEqual(10_500);
    // χ² with 14 degrees of freedom: p < 0.001 above 36.12.
    const expected = rounds / SECTORS;
    const chi = counts.reduce(
      (sum, c) => sum + (c - expected) ** 2 / expected,
      0,
    );
    expect(chi).toBeLessThan(36.12);
  });

  it("stops inside the tile, away from its edges", () => {
    expect(stopOffset("0".repeat(64))).toBeCloseTo(0.1);
    expect(stopOffset("f".repeat(64))).toBeCloseTo(0.9);
    expect(stopOffset("bad")).toBe(0.5);
  });
});
