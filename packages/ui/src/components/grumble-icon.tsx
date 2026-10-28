import { cn } from "@outegro/ui/lib/utils";
import type * as React from "react";

const coin = (
  <>
    <circle
      cx="13.25"
      cy="13.25"
      r="9.75"
      fill="var(--coin-shadow, currentColor)"
    />
    <circle
      cx="10.75"
      cy="10.75"
      r="9.25"
      fill="var(--spot-yellow, #f5c518)"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path
      d="M14.6 7.7A4.6 4.6 0 1 0 15.3 13.3V10.9H11.6"
      stroke="var(--ink, #1b1915)"
      strokeWidth="2.4"
    />
  </>
);

/**
 * The grumble, the platform's own currency (ADR-011): a yellow coin with a
 * Latin G and the zine's hard offset shadow, ink on light paper and spot
 * red in the dark tone (`--coin-shadow`, zine.css). Drawn on a 24-unit
 * grid with strokes of 2 units and more, so it reads from 12 to 64 px; the
 * G has a spur so it is nobody's logo. Decorative next to a number; give
 * it a `title` when it stands alone and means "grumbles".
 */
function GrumbleIcon({
  className,
  title,
  ...props
}: React.ComponentProps<"svg"> & { title?: string }) {
  const shared = {
    "data-slot": "grumble-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    className: cn("size-4 shrink-0", className),
    ...props,
  };
  if (title)
    return (
      <svg role="img" {...shared}>
        <title>{title}</title>
        {coin}
      </svg>
    );
  return (
    <svg aria-hidden="true" {...shared}>
      {coin}
    </svg>
  );
}

export { GrumbleIcon };
