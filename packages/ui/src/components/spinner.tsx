import { cn } from "@outegro/ui/lib/utils";
import type * as React from "react";

/**
 * Busy indicator in the current text colour. It spins; with reduced motion it
 * only pulses. Decorative on its own: pair it with text or `aria-busy`.
 */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn(
        "size-5 animate-spin motion-reduce:animate-pulse",
        className,
      )}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export { Spinner };
