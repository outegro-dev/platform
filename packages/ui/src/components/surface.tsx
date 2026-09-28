import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

const surfaceVariants = cva("rounded-[var(--radius-lg)]", {
  variants: {
    variant: {
      solid: "border border-border bg-surface",
      glass: "og-glass",
      inverse: "bg-[#141513] text-[#f2f2ef]",
      muted: "bg-secondary",
    },
  },
  defaultVariants: { variant: "solid" },
});

/** Card-like container. `inverse` also switches tokens for its children. */
function Surface({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof surfaceVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="surface"
      data-tone={variant === "inverse" ? "dark" : undefined}
      className={cn(surfaceVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Surface, surfaceVariants };
