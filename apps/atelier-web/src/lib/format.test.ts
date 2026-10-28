import { describe, expect, it } from "vitest";
import {
  ageOf,
  formatDuration,
  formatPercent,
  safeTimeZone,
  scoreTone,
} from "./format";
import { nextIndex } from "./inbox";

const now = Date.parse("2026-10-28T12:00:00.000Z");
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

describe("formatting", () => {
  it("says how long ago in one unit", () => {
    expect(ageOf(ago(0), now)).toEqual({ unit: "now", n: 0 });
    expect(ageOf(ago(12), now)).toEqual({ unit: "m", n: 12 });
    expect(ageOf(ago(5 * 60), now)).toEqual({ unit: "h", n: 5 });
    expect(ageOf(ago(3 * 24 * 60), now)).toEqual({ unit: "d", n: 3 });
    expect(ageOf(ago(30 * 24 * 60), now)).toEqual({ unit: "w", n: 4 });
    // A clock a little ahead of the server is "now", not negative.
    expect(ageOf(ago(-3), now).unit).toBe("now");
  });

  it("tints the score: strong from 80, weak under 65", () => {
    expect(scoreTone(88)).toBe("ok");
    expect(scoreTone(80)).toBe("ok");
    expect(scoreTone(72)).toBe("neutral");
    expect(scoreTone(64)).toBe("warn");
    expect(scoreTone(null)).toBe("neutral");
  });

  it("prints durations and percentages in the language of the page", () => {
    expect(formatDuration(850, "en")).toBe("850 ms");
    expect(formatDuration(1_400, "en")).toBe("1.4 sec");
    expect(formatDuration(48_200, "en")).toBe("48 sec");
    expect(formatDuration(180_000, "en")).toBe("3 min");
    expect(formatPercent(0.92, "en")).toBe("92%");
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(safeTimeZone("Asia/Tbilisi")).toBe("Asia/Tbilisi");
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});

describe("the inbox cursor", () => {
  it("moves one step and stops at both ends", () => {
    expect(nextIndex(0, 4, 1)).toBe(1);
    expect(nextIndex(3, 4, 1)).toBe(3);
    expect(nextIndex(0, 4, -1)).toBe(0);
    expect(nextIndex(2, 0, 1)).toBe(0);
  });
});
