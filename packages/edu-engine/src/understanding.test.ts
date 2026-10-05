import { describe, expect, it } from "vitest";
import {
  bestScore,
  isUnderstandingScore,
  isUnderstood,
  UNDERSTOOD_FROM,
} from "./understanding.js";

describe("understanding a chapter", () => {
  it("confirms a chapter from a best score of 7, as the original pages did", () => {
    expect(UNDERSTOOD_FROM).toBe(7);
    expect([1, 6, 7, 8, 10].map(isUnderstood)).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(isUnderstood(null)).toBe(false);
    expect(isUnderstood(undefined)).toBe(false);
  });

  it("takes only whole scores from 1 to 10", () => {
    for (const value of [0, 11, 7.5, -1, Number.NaN, "8", null])
      expect(isUnderstandingScore(value), String(value)).toBe(false);
    expect(isUnderstood(11)).toBe(false);
    expect(isUnderstandingScore(1)).toBe(true);
    expect(isUnderstandingScore(10)).toBe(true);
  });

  it("keeps the best score: a lower one never replaces it", () => {
    expect(bestScore(null, 5)).toBe(5);
    expect(bestScore(5, 8)).toBe(8);
    expect(bestScore(8, 4)).toBe(8);
    expect(bestScore(8, null)).toBe(8);
    expect(bestScore(undefined, undefined)).toBeNull();
    expect(bestScore(6, 42)).toBe(6);
    expect(bestScore(0, 3)).toBe(3);
  });
});
