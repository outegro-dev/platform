"use client";

import { type CSSProperties, useState } from "react";

/**
 * A draining ring for the turn or placement clock. The ring itself is a
 * CSS animation (two rotating half rings) started at the right point, so it
 * glides at 60 fps without re-rendering; only the number updates per second.
 * Remount it (key) when the deadline changes.
 */
export function CountdownRing({
  msLeft,
  totalMs,
  seconds,
  label,
}: {
  msLeft: number;
  totalMs: number;
  seconds: number;
  label: string;
}) {
  // Fixed at mount: the animation's clock runs on its own afterwards.
  const [offset] = useState(() => -Math.max(0, totalMs - msLeft));
  return (
    <div
      className="ring"
      role="timer"
      aria-label={label}
      data-urgent={seconds <= 5 || undefined}
      style={
        {
          "--ring-total": `${totalMs}ms`,
          "--ring-offset": `${offset}ms`,
        } as CSSProperties
      }
    >
      <span className="ring-track" />
      <span className="ring-half" data-half="right">
        <span className="ring-fill" />
      </span>
      <span className="ring-half" data-half="left">
        <span className="ring-fill" />
      </span>
      <span className="ring-value" aria-hidden="true">
        {seconds}
      </span>
    </div>
  );
}
