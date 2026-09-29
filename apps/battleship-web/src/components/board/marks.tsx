import type { CSSProperties } from "react";
import type { Effect } from "@/game/stores/match-store";

export type HitEffect = "flame" | "shards";

const at = (x: number, y: number) => ({ "--x": x, "--y": y }) as CSSProperties;

function Flame() {
  return (
    <svg
      className="flame"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="flame-outer"
        fill="url(#bs-flame)"
        d="M20 3c5.5 7.6 11.8 13.2 10.2 23.1C29 33.4 24.3 37 20 37c-4.6 0-9.2-3.4-10.3-10-.9-6.3 3.1-10.6 5.4-15.2.8 4.4 2.6 6.6 4.2 7.6 1.3-4.3 1.8-9.4.7-16.4Z"
      />
      <path
        className="flame-inner"
        fill="var(--flame-core)"
        d="M20.4 16.5c3.4 4.2 5.7 7.6 5 12.1-.6 3.9-3 6-5.4 6-2.9 0-5.3-2.3-5.4-5.8-.1-2.9 1.6-5.2 3.1-7 .6 1.9 1.3 3 2.2 3.4.9-2.4 1.1-5.2.5-8.7Z"
      />
    </svg>
  );
}

function Shards() {
  return (
    <svg
      className="shards"
      viewBox="0 0 40 40"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="url(#bs-shard)" d="M20 4.5 26 18.5l-6 4.5-5.6-5.4Z" />
      <path fill="url(#bs-shard)" d="m6.5 23.5 10.6-3.1 1.4 7.9-9.6 3.8Z" />
      <path fill="url(#bs-shard)" d="m32.8 21.8 1.7 10.4-10.3-2.2-.9-7.8Z" />
      <path
        fill="var(--shard-light)"
        opacity="0.9"
        d="m20 8.5 2.4 7.6-2.4 1.8Z"
      />
    </svg>
  );
}

/** What stays on a cell after a shot: a splash dot, fire, or silver shards. */
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
    <span className="mark" data-kind={kind} style={at(x, y)}>
      {kind === "miss" ? (
        <span className="mark-dot" />
      ) : effect === "shards" ? (
        <Shards />
      ) : (
        <Flame />
      )}
    </span>
  );
}

/**
 * One animated event over a cell: the tracer of a shot, the splash of a
 * miss, the flash of a hit, or a sinking. Only transform and opacity move.
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
        <circle cx="20" cy="20" r="20" fill="url(#bs-flash)" />
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
              <path fill="url(#bs-shard)" d="M5 0 9 6 4 10 1 4Z" />
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
