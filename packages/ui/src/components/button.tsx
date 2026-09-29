import { cn } from "@outegro/ui/lib/utils";
import { Spinner } from "@outegro/ui/spinner";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-3 rounded-full font-medium whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,translate,scale,opacity] duration-(--duration-base) ease-(--ease-out) motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-60 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-(--primary-hover) motion-safe:hover:-translate-y-0.5",
        secondary:
          "bg-secondary text-foreground hover:bg-muted motion-safe:hover:-translate-y-0.5",
        outline:
          "border border-(--border-strong) bg-transparent text-foreground hover:bg-secondary motion-safe:hover:-translate-y-0.5",
        glass: "og-glass text-foreground motion-safe:hover:-translate-y-0.5",
        ghost: "text-foreground hover:bg-secondary",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 motion-safe:hover:-translate-y-0.5",
        link: "rounded-none text-foreground underline-offset-6 hover:underline",
      },
      size: {
        sm: "h-10 px-5 text-[13px]",
        md: "h-12 px-6 text-sm",
        lg: "h-[58px] px-7 text-[15px]",
        icon: "size-11",
        "icon-sm": "size-9 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    compoundVariants: [
      // A link sits in running text: no padding or height from the size
      // scale, but still a 44 px touch target.
      { variant: "link", className: "h-auto min-h-11 px-0" },
    ],
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
    /**
     * An action is running. The label keeps its place under a spinner, so the
     * button never changes size; it stays focusable (aria-disabled) and
     * ignores clicks, Enter/Space and implicit form submission. Pass
     * `pending={false}` from the start so both states share one DOM shape.
     */
    pending?: boolean;
    /** Accessible name while pending, for example "Saving…". */
    pendingLabel?: string;
  };

const ignoreActivation = (event: React.MouseEvent) => event.preventDefault();

function Button({
  className,
  variant,
  size,
  asChild = false,
  pending,
  pendingLabel,
  children,
  onClick,
  "aria-disabled": ariaDisabled,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild || pending === undefined) {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        data-slot="button"
        data-variant={variant ?? "primary"}
        className={classes}
        aria-disabled={ariaDisabled}
        onClick={onClick}
        {...props}
      >
        {children}
      </Comp>
    );
  }
  return (
    <button
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-pending={pending || undefined}
      aria-busy={pending || undefined}
      aria-disabled={pending || ariaDisabled || undefined}
      className={cn(classes, "relative")}
      onClick={pending ? ignoreActivation : onClick}
      {...props}
    >
      {/* The label keeps the button's flex layout either way: `contents`
          while idle, a box with the same gap while hidden, so it keeps the
          width without counting towards the accessible name. */}
      <span
        className={cn(
          pending ? "inline-flex items-center gap-[inherit]" : "contents",
          pending && (pendingLabel ? "invisible" : "text-transparent"),
        )}
        aria-hidden={pending && pendingLabel ? true : undefined}
      >
        {children}
      </span>
      {pending && (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center"
        >
          <Spinner />
        </span>
      )}
      {pending && pendingLabel && (
        <span className="sr-only">{pendingLabel}</span>
      )}
    </button>
  );
}

export { Button, type ButtonProps, buttonVariants };
