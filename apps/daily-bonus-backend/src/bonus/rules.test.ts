import { describe, expect, it } from "vitest";
import {
  cryptoRandom,
  defaultPrizes,
  drawPrize,
  expectedPrize,
  nextStreak,
  streakBonusPercent,
  withStreak,
} from "./rules.js";

describe("bonus rules", () => {
  it("draws from the OS generator in [0, 1) and covers the table", () => {
    const hits = new Set<number>();
    for (let i = 0; i < 20_000; i++) {
      const x = cryptoRandom();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      hits.add(drawPrize(defaultPrizes, () => x));
    }
    // Even the 0.5 % line comes up in 20 000 draws.
    expect(hits.size).toBe(defaultPrizes.length);
  });

  it("averages 143.25 grumbles on the plan's table", () => {
    expect(expectedPrize(defaultPrizes)).toBeCloseTo(143.25);
  });

  it("adds 10 % a day up to 60 %, only while streaks are on", () => {
    expect(
      [1, 2, 3, 7, 8, 30].map((day) => streakBonusPercent(day, true)),
    ).toEqual([0, 10, 20, 60, 60, 60]);
    expect(streakBonusPercent(5, false)).toBe(0);
    expect(withStreak(25, 10)).toBe(28);
    const at = new Date("2026-10-28T10:00:00Z");
    const last = { claimedAt: at, streak: 4 };
    expect(nextStreak(last, new Date(at.getTime() + 47 * 3600_000), true)).toBe(
      5,
    );
    expect(nextStreak(last, new Date(at.getTime() + 49 * 3600_000), true)).toBe(
      1,
    );
    expect(
      nextStreak(last, new Date(at.getTime() + 25 * 3600_000), false),
    ).toBe(1);
  });
});
