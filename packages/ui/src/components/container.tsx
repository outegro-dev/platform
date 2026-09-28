import { cn } from "@outegro/ui/lib/utils";
import { Slot } from "radix-ui";
import type * as React from "react";

/** Shared page width and gutters (56 / 32 / 20 px). */
function Container({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      data-slot="container"
      className={cn("og-container", className)}
      {...props}
    />
  );
}

export { Container };
