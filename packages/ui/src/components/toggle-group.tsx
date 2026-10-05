"use client";

import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, use, useState } from "react";

/*
 * A set of toggle buttons on Radix. type="single" is a radio group (one
 * choice: role=radio, aria-checked), type="multiple" a toolbar of
 * independent toggles (aria-pressed). Tab enters the group, arrow keys
 * move, Space/Enter toggles. Name the group with aria-label/-labelledby.
 */

const toggleGroupVariants = cva("max-w-full", {
  variants: {
    variant: {
      // Separate pills that wrap onto more lines (filters).
      chip: "flex flex-wrap items-center gap-2",
      // One joined control (speed, view mode).
      segmented:
        "inline-flex items-stretch gap-0.5 rounded-full border border-border bg-surface p-[3px]",
    },
    size: { sm: "", md: "" },
  },
  defaultVariants: { variant: "chip", size: "md" },
});

const toggleGroupItemVariants = cva(
  // Each item is positioned so its ::after can take the touch target to
  // 44 px when the item itself is drawn smaller. One weight in every state.
  "relative inline-flex min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-full font-medium transition-[color,background-color,border-color] duration-(--duration-fast) ease-(--ease-out) select-none after:absolute after:inset-x-0 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Long labels wrap inside the chip instead of overflowing the row;
        // the ring stays inside the 8 px gap between chips.
        chip: "border border-(--border-strong) bg-surface text-center text-foreground hover:border-foreground focus-visible:outline-offset-2 data-[state=on]:border-primary",
        // Inside the joined control: a tight ring around the segment.
        segmented:
          "text-center text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-offset-1 data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground",
      },
      size: { sm: "", md: "" },
    },
    compoundVariants: [
      // 36 px chips: ::after (measured inside the 1 px border) reaches 4 px
      // past the chip above and below — it meets the next row halfway
      // across the 8 px gap.
      {
        variant: "chip",
        size: "sm",
        className:
          "min-h-9 px-3.5 py-1 text-[13px] leading-[1.3] after:-inset-y-[5px]",
      },
      // 44 px chips: the item is the target.
      {
        variant: "chip",
        size: "md",
        className: "min-h-11 px-4 py-1.5 text-sm leading-[1.3] after:hidden",
      },
      // 40 px control, 32 px segments: ::after adds 6 px above and below.
      {
        variant: "segmented",
        size: "sm",
        className:
          "min-h-8 px-3 py-1 text-[13px] leading-[1.3] after:-inset-y-1.5",
      },
      // 48 px control, 40 px segments: ::after adds 2 px above and below.
      {
        variant: "segmented",
        size: "md",
        className:
          "min-h-10 px-4 py-1.5 text-sm leading-[1.3] after:-inset-y-0.5",
      },
    ],
    defaultVariants: { variant: "chip", size: "md" },
  },
);

type ToggleGroupStyle = {
  variant: NonNullable<VariantProps<typeof toggleGroupVariants>["variant"]>;
  size: NonNullable<VariantProps<typeof toggleGroupVariants>["size"]>;
};

const ToggleGroupStyleContext = createContext<ToggleGroupStyle>({
  variant: "chip",
  size: "md",
});

type ToggleGroupProps = React.ComponentProps<typeof ToggleGroupPrimitive.Root> &
  Partial<ToggleGroupStyle> & {
    /**
     * type="single" only: let a second press on the chosen item clear the
     * choice (value ""). Off by default — like radio buttons, one item
     * stays chosen.
     */
    deselectable?: boolean;
  };

function ToggleGroup({
  className,
  variant = "chip",
  size = "md",
  deselectable = false,
  ...props
}: ToggleGroupProps) {
  const shared = {
    "data-slot": "toggle-group",
    "data-variant": variant,
    "data-size": size,
    className: cn(toggleGroupVariants({ variant, size }), className),
  };
  return (
    <ToggleGroupStyleContext value={{ variant, size }}>
      {props.type === "single" && !deselectable ? (
        <SingleKeepsChoice {...props} {...shared} />
      ) : (
        <ToggleGroupPrimitive.Root {...props} {...shared} />
      )}
    </ToggleGroupStyleContext>
  );
}

/** Ignores the empty value Radix sends when the chosen item is pressed again. */
function SingleKeepsChoice({
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & {
  type: "single";
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  return (
    <ToggleGroupPrimitive.Root
      {...props}
      value={value ?? own}
      onValueChange={(next: string) => {
        if (!next) return;
        setOwn(next);
        onValueChange?.(next);
      }}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  const { variant, size } = use(ToggleGroupStyleContext);
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export {
  ToggleGroup,
  ToggleGroupItem,
  type ToggleGroupProps,
  toggleGroupItemVariants,
  toggleGroupVariants,
};
