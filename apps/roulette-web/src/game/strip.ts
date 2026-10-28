import { SECTORS, stopOffset, stripOrder } from "@outegro/roulette-engine";

/** How many times the 15 tiles repeat on the strip. */
export const STRIP_REPEATS = 14;
/** A strip at rest shows its number in the second repeat, so tiles fill both sides. */
const REST_REPEAT = 1;

/**
 * How a spin moves: how far it goes and how it slows down. An ordinary spin
 * travels about eight turns; a mega spin about eleven in the same 6 s, so it
 * starts sharper and crawls longer at the end. Both curves only ever slow
 * down and never overshoot: the strip does not pause on a neighbour and
 * then slip into the result, there is no fake near miss.
 */
export type SpinProfile = {
  landingRepeat: number;
  ease: (t: number) => number;
};

export const ordinarySpin: SpinProfile = {
  landingRepeat: 9,
  ease: (t) => 1 - (1 - clamp01(t)) ** 4,
};

export const megaSpin: SpinProfile = {
  landingRepeat: 12,
  ease: (t) => 1 - (1 - clamp01(t)) ** 5,
};

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

/** The tiles in strip order, repeated: what the strip renders. */
export function stripTiles(): number[] {
  const tiles: number[] = [];
  for (let repeat = 0; repeat < STRIP_REPEATS; repeat++)
    tiles.push(...stripOrder);
  return tiles;
}

function slotOf(number: number): number {
  const slot = stripOrder.indexOf(number);
  if (slot < 0) throw new RangeError(`not a sector: ${number}`);
  return slot;
}

/** Strip geometry in pixels, measured from the rendered tiles. */
export type StripMetrics = {
  /** Width of one tile. */
  tile: number;
  /** Gap between tiles. */
  gap: number;
  /** Width of the visible window; the marker is in its middle. */
  view: number;
};

/** A point on the strip: a tile and where inside it (0..1) the marker sits. */
export type StripPoint = { index: number; within: number };

/** Where a strip rests showing `number` (after a reload: the tile's middle). */
export function restPoint(number: number, seed?: string | null): StripPoint {
  return {
    index: REST_REPEAT * SECTORS + slotOf(number),
    within: seed ? stopOffset(seed) : 0.5,
  };
}

/** Where a spin stops: the same tile far ahead, at the seed's offset. */
export function landingPoint(
  number: number,
  seed: string,
  profile: SpinProfile = ordinarySpin,
): StripPoint {
  return {
    index: profile.landingRepeat * SECTORS + slotOf(number),
    within: stopOffset(seed),
  };
}

/** Distance of a point from the strip's left edge. */
export function pixelsOf(point: StripPoint, metrics: StripMetrics): number {
  return (
    point.index * (metrics.tile + metrics.gap) + point.within * metrics.tile
  );
}

/** The strip's translateX that puts `pixels` under the marker. */
export function translateFor(pixels: number, metrics: StripMetrics): number {
  return metrics.view / 2 - pixels;
}

/** The ordinary curve, exported for tests and the daily ribbon. */
export function easeOutSpin(t: number): number {
  return ordinarySpin.ease(t);
}

export type SpinInput = {
  /** The number shown before the spin (the previous result). */
  from: { number: number; seed?: string | null };
  /** The result and its seed. */
  to: { number: number; seed: string };
  /** When the spin started, in server time (epoch ms). */
  startAt: number;
  durationMs: number;
  /** Now, in server time (epoch ms). */
  now: number;
  /** A mega round (every third): further and sharper, same duration. */
  mega?: boolean;
  /** Skip the motion: show the stop at once. */
  reducedMotion?: boolean;
};

/**
 * The strip's position at `now`: every client computes it from the same
 * server start time, so all stop at the same pixel, and a tab that joins
 * mid-spin lands straight in the right frame. Returns the pixel under the
 * marker and whether the spin is over.
 */
export function spinFrame(
  input: SpinInput,
  metrics: StripMetrics,
): { pixels: number; done: boolean } {
  const profile = input.mega ? megaSpin : ordinarySpin;
  const start = pixelsOf(
    restPoint(input.from.number, input.from.seed),
    metrics,
  );
  const end = pixelsOf(
    landingPoint(input.to.number, input.to.seed, profile),
    metrics,
  );
  if (input.reducedMotion) return { pixels: end, done: true };
  const t = (input.now - input.startAt) / input.durationMs;
  if (t <= 0) return { pixels: start, done: false };
  if (t >= 1) return { pixels: end, done: true };
  return { pixels: start + (end - start) * profile.ease(t), done: false };
}
