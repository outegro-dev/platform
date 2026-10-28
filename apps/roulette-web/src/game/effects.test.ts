import { describe, expect, it } from "vitest";
import {
  fxAt,
  isMegaRound,
  rainDrops,
  roundEffects,
  STOP_EFFECTS_MS,
} from "./effects";

describe("roundEffects", () => {
  it("makes every third round a mega spin", () => {
    expect([1, 2, 3, 4, 5, 6].map(isMegaRound)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it("an ordinary round on red or black has no extras", () => {
    expect(roundEffects(7, { color: "red" }, false)).toEqual({
      mega: false,
      green: false,
      stamps: [],
      speedLines: false,
      shake: false,
      rain: false,
      flash: false,
      greenWinners: false,
    });
  });

  it("a mega round has speed lines while it spins, a stamp and a shake on the stop", () => {
    const spinning = roundEffects(9, null, false);
    expect(spinning).toMatchObject({
      mega: true,
      speedLines: true,
      stamps: [],
      shake: false,
    });
    expect(roundEffects(9, { color: "black" }, false)).toMatchObject({
      stamps: ["mega"],
      shake: true,
      rain: false,
    });
  });

  it("green gets its stamp, the coin rain, the flash and lit winners", () => {
    expect(roundEffects(10, { color: "green" }, false)).toEqual({
      mega: false,
      green: true,
      stamps: ["green"],
      speedLines: false,
      shake: false,
      rain: true,
      flash: true,
      greenWinners: true,
    });
    expect(roundEffects(12, { color: "green" }, false).stamps).toEqual([
      "mega",
      "green",
    ]);
  });

  it("with reduced motion keeps only the stamps and the lit winners", () => {
    expect(roundEffects(12, { color: "green" }, true)).toEqual({
      mega: true,
      green: true,
      stamps: ["mega", "green"],
      speedLines: false,
      shake: false,
      rain: false,
      flash: false,
      greenWinners: true,
    });
  });

  it("times the effects from the server's spin start", () => {
    const base = {
      round: 12,
      result: { color: "green" as const },
      startAt: 10_000,
      durationMs: 6_000,
      reducedMotion: false,
    };
    expect(fxAt({ ...base, now: 9_000 })).toMatchObject({
      spinning: false,
      stopped: false,
    });
    expect(fxAt({ ...base, now: 12_000 })).toMatchObject({
      spinning: true,
      stopped: false,
    });
    expect(fxAt({ ...base, now: 16_000 })).toMatchObject({
      spinning: false,
      stopped: true,
    });
    expect(fxAt({ ...base, now: 16_000 + STOP_EFFECTS_MS })).toMatchObject({
      stopped: false,
    });
    expect(
      fxAt({ ...base, result: null, startAt: null, now: 12_000 }),
    ).toMatchObject({ spinning: false, stopped: false });
  });

  it("depends on nothing but the round and the result", () => {
    expect(roundEffects(15, { color: "red" }, false)).toEqual(
      roundEffects(15, { color: "red" }, false),
    );
    expect(rainDrops()).toEqual(rainDrops());
    for (const drop of rainDrops()) {
      expect(drop.left).toBeGreaterThanOrEqual(0);
      expect(drop.left).toBeLessThan(100);
    }
  });
});
