import type { Color } from "@outegro/roulette-engine";

/** Every third round is a mega spin (owner, 28.10.2026). */
export const MEGA_EVERY = 3;

export function isMegaRound(round: number): boolean {
  return round % MEGA_EVERY === 0;
}

export type Stamp = "mega" | "green";

/** What a round shows besides the strip itself. */
export type RoundEffects = {
  /** A mega spin: same 6 s, sharper start, longer crawl, speed lines. */
  mega: boolean;
  /** Green came up: ×14. */
  green: boolean;
  /** Zine stamps on the stop, in this order. */
  stamps: Stamp[];
  /** Streaks over the strip while a mega spin runs. */
  speedLines: boolean;
  /** A light shake of the strip on a mega stop. */
  shake: boolean;
  /** Grumble coins falling over the table on green. */
  rain: boolean;
  /** The table flashes green. */
  flash: boolean;
  /** Winners in the green column lit up. */
  greenWinners: boolean;
};

/**
 * The effects of a round depend on its number and its result only, so every
 * client shows the same thing. With reduced motion only the stamps (and the
 * highlighted winners) stay: no shake, no rain, no flash, no speed lines.
 */
export function roundEffects(
  round: number,
  result: { color: Color } | null,
  reducedMotion: boolean,
): RoundEffects {
  const mega = isMegaRound(round);
  const green = result?.color === "green";
  const stamps: Stamp[] = [];
  if (result && mega) stamps.push("mega");
  if (green) stamps.push("green");
  const motion = !reducedMotion;
  return {
    mega,
    green,
    stamps,
    speedLines: mega && motion,
    shake: mega && result !== null && motion,
    rain: green && motion,
    flash: green && motion,
    greenWinners: green,
  };
}

/** How long the stop's effects stay on screen, ms. */
export const STOP_EFFECTS_MS = 2800;

export type FxMoment = {
  effects: RoundEffects;
  /** The strip is moving. */
  spinning: boolean;
  /** The strip has just stopped: stamps, shake, rain and flash are on. */
  stopped: boolean;
};

/**
 * What a round shows at server time `now`: the same on every screen, since
 * the spin's start comes from the server and the rest from the round.
 */
export function fxAt(input: {
  round: number;
  result: { color: Color } | null;
  /** The spin's start (server epoch ms), null before the number is known. */
  startAt: number | null;
  durationMs: number;
  now: number;
  reducedMotion: boolean;
}): FxMoment {
  const effects = roundEffects(input.round, input.result, input.reducedMotion);
  if (input.startAt === null || !input.result)
    return { effects, spinning: false, stopped: false };
  const end = input.startAt + input.durationMs;
  return {
    effects,
    spinning: input.now >= input.startAt && input.now < end,
    stopped: input.now >= end && input.now < end + STOP_EFFECTS_MS,
  };
}

/** Coins of the green rain: positions come from the index, the same on every screen. */
export function rainDrops(count = 18): {
  left: number;
  delayMs: number;
  durationMs: number;
  size: number;
}[] {
  return Array.from({ length: count }, (_, i) => ({
    left: (i * 37 + 11) % 100,
    delayMs: (i * 131) % 900,
    durationMs: 1400 + ((i * 7) % 5) * 120,
    size: 18 + ((i * 5) % 3) * 6,
  }));
}
