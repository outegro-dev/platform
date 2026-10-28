"use client";

import { colorOf } from "@outegro/roulette-engine";
import { memo, useEffect, useMemo, useRef } from "react";
import {
  pixelsOf,
  restPoint,
  type StripMetrics,
  spinFrame,
  stripTiles,
  translateFor,
} from "@/game/strip";

export type StripSpin = {
  from: { number: number; seed?: string };
  to: { number: number; seed: string };
  startAt: number;
  durationMs: number;
  mega: boolean;
};

type StripProps = {
  rest: { number: number; seed?: string } | null;
  spin: StripSpin | null;
  /** Current server time (epoch ms); read on every frame. */
  serverNow: () => number;
  reducedMotion: boolean;
};

const spinKeyOf = (spin: StripSpin | null) =>
  spin
    ? `${spin.from.number}:${spin.from.seed ?? ""}:${spin.to.number}:${spin.to.seed}:${spin.startAt}:${spin.durationMs}:${spin.mega}`
    : null;

/**
 * The strip of 15 sectors under the marker. It rests on the last result and
 * spins from the server's start time, frame by frame: every tab computes
 * the same position for the same moment, so all stop together and a tab
 * opened mid-spin starts in the right frame. Decorative for screen readers:
 * the phase bar announces the result. Re-renders only when the spin or the
 * rest changes, not on every tick of its parent.
 */
export const StripView = memo(
  function StripView({ rest, spin, serverNow, reducedMotion }: StripProps) {
    const viewRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const now = useRef(serverNow);
    now.current = serverNow;
    const tiles = useMemo(stripTiles, []);
    const restNumber = rest?.number ?? null;
    const restSeed = rest?.seed;
    const spinKey = spinKeyOf(spin);
    // The spin as of this render; the effect restarts only when its key does.
    const current = useRef(spin);
    current.current = spin;

    useEffect(() => {
      const view = viewRef.current;
      const strip = stripRef.current;
      if (!view || !strip) return;
      let frame = 0;
      const measure = (): StripMetrics | null => {
        const first = strip.firstElementChild;
        if (!(first instanceof HTMLElement)) return null;
        return {
          tile: first.getBoundingClientRect().width,
          gap: Number.parseFloat(getComputedStyle(strip).columnGap) || 0,
          view: view.clientWidth,
        };
      };
      const place = (pixels: number, metrics: StripMetrics) => {
        strip.style.transform = `translate3d(${translateFor(pixels, metrics)}px, 0, 0)`;
      };
      const draw = () => {
        const metrics = measure();
        if (!metrics) return;
        const active = spinKey ? current.current : null;
        if (active) {
          const result = spinFrame(
            { ...active, now: now.current(), reducedMotion },
            metrics,
          );
          place(result.pixels, metrics);
          if (!result.done) frame = requestAnimationFrame(draw);
          return;
        }
        place(pixelsOf(restPoint(restNumber ?? 0, restSeed), metrics), metrics);
      };
      draw();
      const resize = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        draw();
      });
      resize.observe(view);
      return () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
      };
    }, [spinKey, restNumber, restSeed, reducedMotion]);

    return (
      <div className="rl-view" ref={viewRef} aria-hidden="true">
        <div className="rl-strip" ref={stripRef}>
          {tiles.map((number, index) => (
            <div
              // The strip never reorders: the position is the identity.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, repeating strip
              key={index}
              className={`rl-tile rl-${colorOf(number)}`}
            >
              {number}
            </div>
          ))}
        </div>
        <div className="rl-marker" />
      </div>
    );
  },
  (before, after) =>
    spinKeyOf(before.spin) === spinKeyOf(after.spin) &&
    before.rest?.number === after.rest?.number &&
    before.rest?.seed === after.rest?.seed &&
    before.reducedMotion === after.reducedMotion,
);
