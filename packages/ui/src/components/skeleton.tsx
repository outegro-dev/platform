import { cn } from "@outegro/ui/lib/utils";
import type * as React from "react";

/**
 * Placeholder block for content that is still loading. Give it the size of
 * the content it stands for, so the swap moves nothing. Hidden from
 * assistive technology: announce loading with text next to it.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "block animate-pulse rounded-md bg-secondary motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
