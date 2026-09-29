import { cn } from "@outegro/ui/lib/utils";
import { Spinner } from "@outegro/ui/spinner";
import {
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type * as React from "react";

const tones = {
  neutral: "text-muted-foreground",
  pending: "text-muted-foreground",
  success: "text-success",
  error: "text-destructive",
} as const;

// 20 px lines: one, two or three of them stay reserved.
const reserve = { 1: "min-h-5", 2: "min-h-10", 3: "min-h-15" } as const;

const icons = {
  neutral: null,
  pending: <Spinner />,
  success: <CheckCircleIcon weight="bold" />,
  error: <WarningCircleIcon weight="bold" />,
} as const;

/**
 * Hint under a field or the result of a form. It is always rendered and
 * keeps `lines` of height, so a message appearing, changing or wrapping never
 * moves the controls around it. Announce changes with `aria-live` (or
 * `role="status"`) on it.
 */
function FormMessage({
  tone = "neutral",
  lines = 1,
  icon,
  className,
  children,
  ...props
}: React.ComponentProps<"p"> & {
  tone?: keyof typeof tones;
  lines?: keyof typeof reserve;
  /** Replaces the tone's icon, for example a no-connection glyph. */
  icon?: React.ReactNode;
}) {
  const glyph = icon ?? icons[tone];
  return (
    <p
      data-slot="form-message"
      data-tone={tone}
      className={cn(
        "flex items-start gap-2 text-[13px] leading-5",
        reserve[lines],
        tones[tone],
        className,
      )}
      {...props}
    >
      {children && glyph ? (
        <span
          aria-hidden="true"
          className="flex h-5 shrink-0 items-center [&_svg]:size-4"
        >
          {glyph}
        </span>
      ) : null}
      {children}
    </p>
  );
}

export { FormMessage };
