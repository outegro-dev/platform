import { stopOffset, stripOrder } from "@outegro/roulette-engine";
import { describe, expect, it } from "vitest";
import {
  easeOutSpin,
  landingPoint,
  megaSpin,
  ordinarySpin,
  pixelsOf,
  restPoint,
  STRIP_REPEATS,
  spinFrame,
  stripTiles,
  translateFor,
} from "./strip";

const metrics = { tile: 64, gap: 3, view: 640 };
const seed = `${"ab".repeat(30)}c0de`;

describe("strip", () => {
  it("repeats the wheel order", () => {
    const tiles = stripTiles();
    expect(tiles).toHaveLength(15 * STRIP_REPEATS);
    expect(tiles.slice(15, 30)).toEqual([...stripOrder]);
  });

  it("puts the result under the marker at the seed's offset", () => {
    const point = landingPoint(0, seed);
    expect(tiles(point.index)).toBe(0);
    expect(point.within).toBeCloseTo(stopOffset(seed));
    const pixels = pixelsOf(point, metrics);
    // The marker (the middle of the view) falls inside tile `index`.
    const x = translateFor(pixels, metrics);
    const markerOnStrip = metrics.view / 2 - x;
    const left = point.index * (metrics.tile + metrics.gap);
    expect(markerOnStrip).toBeGreaterThan(left);
    expect(markerOnStrip).toBeLessThan(left + metrics.tile);
  });

  it("spins from the last result to the new one on the same timeline for everyone", () => {
    const input = {
      from: { number: 8 },
      to: { number: 3, seed },
      startAt: 1_000,
      durationMs: 6_000,
    };
    const before = spinFrame({ ...input, now: 500 }, metrics);
    expect(before).toEqual({
      pixels: pixelsOf(restPoint(8), metrics),
      done: false,
    });
    const middle = spinFrame({ ...input, now: 4_000 }, metrics);
    expect(middle.done).toBe(false);
    expect(middle.pixels).toBeGreaterThan(before.pixels);
    const end = spinFrame({ ...input, now: 7_000 }, metrics);
    expect(end).toEqual({
      pixels: pixelsOf(landingPoint(3, seed), metrics),
      done: true,
    });
    // A tab joining mid-spin computes the same frame.
    expect(spinFrame({ ...input, now: 4_000 }, metrics)).toEqual(middle);
    // Reduced motion: straight to the stop.
    expect(
      spinFrame({ ...input, now: 1_500, reducedMotion: true }, metrics),
    ).toEqual(end);
  });

  it("a mega spin goes further in the same time and lands on the same result", () => {
    const input = {
      from: { number: 8 },
      to: { number: 3, seed },
      startAt: 0,
      durationMs: 6_000,
    };
    const ordinary = spinFrame({ ...input, now: 6_000 }, metrics);
    const mega = spinFrame({ ...input, now: 6_000, mega: true }, metrics);
    expect(mega.done && ordinary.done).toBe(true);
    expect(mega.pixels).toBeGreaterThan(ordinary.pixels);
    expect(tiles(landingPoint(3, seed, megaSpin).index)).toBe(3);
    expect(landingPoint(3, seed, megaSpin).index).toBeLessThan(
      15 * STRIP_REPEATS,
    );
  });

  it("never fakes a near miss: the strip only slows down and never comes back", () => {
    for (const mega of [false, true]) {
      let last = Number.NEGATIVE_INFINITY;
      let lastStep = Number.POSITIVE_INFINITY;
      for (let now = 0; now <= 6_000; now += 50) {
        const { pixels } = spinFrame(
          {
            from: { number: 8 },
            to: { number: 0, seed },
            startAt: 0,
            durationMs: 6_000,
            now,
            mega,
          },
          metrics,
        );
        const step = pixels - last;
        expect(pixels).toBeGreaterThanOrEqual(last);
        if (Number.isFinite(last))
          expect(step).toBeLessThanOrEqual(lastStep + 1e-6);
        if (Number.isFinite(last)) lastStep = step;
        last = pixels;
      }
      const profile = mega ? megaSpin : ordinarySpin;
      expect(last).toBe(pixelsOf(landingPoint(0, seed, profile), metrics));
    }
    expect(ordinarySpin.ease(0.5)).toBeGreaterThan(0.9);
  });

  it("eases out and stays within 0..1", () => {
    expect(easeOutSpin(-1)).toBe(0);
    expect(easeOutSpin(0)).toBe(0);
    expect(easeOutSpin(0.5)).toBeGreaterThan(0.9);
    expect(easeOutSpin(1)).toBe(1);
    expect(easeOutSpin(2)).toBe(1);
  });

  it("rests in the middle of a tile without a seed", () => {
    expect(restPoint(0).within).toBe(0.5);
    expect(tiles(restPoint(14).index)).toBe(14);
  });
});

function tiles(index: number) {
  return stripTiles()[index];
}
