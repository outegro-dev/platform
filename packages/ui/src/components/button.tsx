import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-3 rounded-full font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,transform] duration-(--duration-base) ease-(--ease-out) active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:-translate-y-0.5 hover:bg-(--primary-hover)",
        secondary:
          "bg-secondary text-foreground hover:-translate-y-0.5 hover:bg-muted",
        outline:
          "border border-(--border-strong) bg-transparent text-foreground hover:-translate-y-0.5 hover:bg-secondary",
        glass: "og-glass text-foreground hover:-translate-y-0.5",
        ghost: "text-foreground hover:bg-secondary",
        destructive:
          "bg-destructive text-white hover:-translate-y-0.5 hover:bg-destructive/90",
        link: "h-auto rounded-none px-0 text-foreground underline-offset-6 hover:underline",
      },
      size: {
        sm: "h-10 px-5 text-[13px]",
        md: "h-12 px-6 text-sm",
        lg: "h-[58px] px-7 text-[15px]",
        icon: "size-11",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child (for example a link) with button styling. */
    asChild?: boolean;
  };

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "primary"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, type ButtonProps, buttonVariants };
