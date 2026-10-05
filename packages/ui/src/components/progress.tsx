"use client";

import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Progress as ProgressPrimitive } from "radix-ui";
import type * as React from "react";

const progressVariants = cva(
  // The track is a tint of the text colour, so it shows on any surface.
  "relative w-full overflow-hidden rounded-full bg-foreground/10 forced-colors:border forced-colors:border-[CanvasText]",
  {
    variants: {
      size: { sm: "h-1.5", md: "h-2", lg: "h-3" },
    },
    defaultVariants: { size: "md" },
  },
);

const progressIndicatorVariants = cva(
  // Moved, never resized: the fill slides with transform (compositor only)
  // and stands still with reduced motion.
  "size-full rounded-full transition-transform duration-(--duration-base) ease-(--ease-out) motion-reduce:transition-none forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none",
  {
    variants: {
      // accent is the primary ink unless the caller sets --progress-fill
      // to another token (a book's accent, for example).
      tone: {
        accent: "bg-[var(--progress-fill,var(--primary))]",
        ok: "bg-ok",
      },
    },
    defaultVariants: { tone: "accent" },
  },
);

/** An accessible name is required: a translated `label`, or the id of a visible one. */
type ProgressName =
  | { label: string; "aria-labelledby"?: undefined }
  | { label?: undefined; "aria-labelledby": string };

type ProgressProps = Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  | "value"
  | "max"
  | "getValueLabel"
  | "children"
  | "aria-label"
  | "aria-labelledby"
  | "aria-valuetext"
> &
  VariantProps<typeof progressVariants> &
  VariantProps<typeof progressIndicatorVariants> &
  ProgressName & {
    /** Done so far, in the units of `max`; out-of-range values are clamped. */
    value: number;
    /** Total (default 100); zero, negative or not a number reads as nothing done. */
    max?: number;
    /** Spoken value, for example "3 of 10 solved" (default: the percentage). */
    valueText?: string;
  };

/**
 * `value` within [0, max] and how much of the track it fills (`offset`: how
 * far, in percent, the fill sits to the left). Never throws, so Radix never
 * sees an invalid value.
 */
function progressRange(value: number, max = 100) {
  if (!Number.isFinite(max) || max <= 0)
    return { value: 0, max: 100, offset: 100 };
  const done = Number.isNaN(value) ? 0 : Math.min(Math.max(value, 0), max);
  return { value: done, max, offset: Math.round((1 - done / max) * 1e4) / 100 };
}

/**
 * Determinate progress bar: role=progressbar with aria-valuenow, -valuemax
 * and -valuetext. It shows no text itself — keep the visible numbers next
 * to it and point `aria-labelledby` at the visible label, or pass `label`.
 */
function Progress({
  value,
  max,
  valueText,
  label,
  tone,
  size,
  className,
  ...props
}: ProgressProps) {
  const range = progressRange(value, max);
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      data-tone={tone ?? "accent"}
      value={range.value}
      max={range.max}
      aria-label={label}
      {...(valueText === undefined ? {} : { "aria-valuetext": valueText })}
      className={cn(progressVariants({ size }), className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={progressIndicatorVariants({ tone })}
        style={{ transform: `translateX(${-range.offset}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export {
  Progress,
  type ProgressProps,
  progressIndicatorVariants,
  progressRange,
  progressVariants,
};
