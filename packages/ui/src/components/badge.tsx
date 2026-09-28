import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full font-mono text-[12px] leading-none font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        outline: "border border-border px-3 py-2 text-foreground",
        solid: "bg-primary px-3 py-2 text-primary-foreground",
        glass: "og-glass px-3 py-2 text-foreground",
        muted: "bg-secondary px-3 py-2 text-muted-foreground",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
