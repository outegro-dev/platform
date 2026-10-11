import type { CSSProperties } from "react";
import type { Effect } from "@/game/stores/match-store";

export type HitEffect = "flame" | "shards";

const at = (x: number, y: number) => ({ "--x": x, "--y": y }) as CSSProperties;

const CROSS = ["M9.5 10.5Q19 18.5 30.5 29.5", "M30 9.5Q21.5 20.5 10 30.5"];

/** A hit in red felt-tip: two strokes over a paper-white edge, drawn in. */
function MarkerCross() {
  return (
    <svg
      className="mark-cross"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <path className="mark-cross-halo" d={CROSS.join("")} />
      {CROSS.map((d) => (
        <path key={d} className="mark-cross-ink" d={d} pathLength={1} />
      ))}
    </svg>
  );
}

/** A hit as a rubber stamp: a framed, shattered star in red ink. */
function RubberStamp() {
  return (
    <svg
      className="mark-stamp"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="mark-stamp-pad" x="5" y="5" width="30" height="30" />
      <path
        className="mark-stamp-ink"
        d="M20 9 21.8 15.8 27.8 12.2 24.3 18.2 31 20 24.3 21.8 27.8 27.8 21.8 24.3 20 31 18.2 24.3 12.2 27.8 15.8 21.8 9 20 15.8 18.2 12.2 12.2 18.2 15.8Z"
      />
    </svg>
  );
}

/**
 * What stays on a cell after a shot: a pencil dot for a miss; for a hit a
 * red marker cross (the "flame" effect) or a rubber stamp ("shards"), over
 * a highlighter swipe while the ship still floats.
 */
export function CellMark({
  x,
  y,
  kind,
  effect,
}: {
  x: number;
  y: number;
  kind: "miss" | "hit" | "sunk";
  effect: HitEffect;
}) {
  return (
    <span
      className="mark"
      data-kind={kind}
      data-effect={kind === "miss" ? undefined : effect}
      style={at(x, y)}
    >
      {kind === "miss" ? (
        <span className="mark-dot" />
      ) : effect === "shards" ? (
        <RubberStamp />
      ) : (
        <MarkerCross />
      )}
    </span>
  );
}

/**
 * Corner brackets around the cell of the latest shot on a board (the move
 * being shown in a replay). A shape, so it never reads as colour alone.
 */
export function ShotMarker({ x, y }: { x: number; y: number }) {
  return (
    <span className="shot-marker" style={at(x, y)}>
      <svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <path d="M3 13V3h10M27 3h10v10M37 27v10H27M13 37H3V27" />
      </svg>
    </span>
  );
}

/**
 * One animated event over a cell: the pencil stroke of a shot, rings of a
 * miss, a cut-paper "bang" with confetti (or paper shards) for a hit, and
 * bubbles for a sinking. Only transform and opacity move.
 */
export function EffectView({
  effect,
  hitEffect,
  from,
}: {
  effect: Effect;
  hitEffect: HitEffect;
  /** Where shots come from, in cells relative to the board (e.g. below it). */
  from: { x: number; y: number };
}) {
  const { x, y, kind } = effect;
  if (kind === "fire") {
    const dx = from.x - x;
    const dy = from.y - y;
    const angle = (Math.atan2(-dy, -dx) * 180) / Math.PI;
    return (
      <span
        className="fx fx-tracer"
        style={
          {
            ...at(x, y),
            "--dx": dx,
            "--dy": dy,
            "--angle": `${angle}deg`,
          } as CSSProperties
        }
      >
        <span className="fx-tracer-body">
          <span className="fx-tracer-trail" />
          <span className="fx-tracer-dot" />
        </span>
      </span>
    );
  }
  if (kind === "miss") {
    return (
      <span className="fx fx-splash" style={at(x, y)}>
        <i />
        <i />
        <i />
        <b />
      </span>
    );
  }
  const particles = hitEffect === "shards" ? 7 : 6;
  return (
    <span
      className="fx fx-hit"
      data-kind={kind}
      data-effect={hitEffect}
      style={at(x, y)}
    >
      <svg
        className="fx-flash"
        viewBox="0 0 40 40"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M20 1 22.9 9.4 29.5 3.6 27.8 12.2 36.5 10.5 30.6 17.2 39 20 30.6 22.9 36.5 29.5 27.8 27.8 29.5 36.5 22.9 30.6 20 39 17.2 30.6 10.5 36.5 12.2 27.8 3.6 29.5 9.4 22.9 1 20 9.4 17.2 3.6 10.5 12.2 12.2 10.5 3.6 17.2 9.4Z" />
      </svg>
      <span className="fx-ring" />
      {Array.from({ length: particles }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative set
          key={i}
          className="fx-particle"
          style={{ "--i": i, "--n": particles } as CSSProperties}
        >
          {hitEffect === "shards" ? (
            <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
              <path d="M5 0 9 6 4 10 1 4Z" />
            </svg>
          ) : null}
        </span>
      ))}
      {kind === "sunk" ? (
        <span className="fx-bubbles">
          <i />
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </span>
  );
}
