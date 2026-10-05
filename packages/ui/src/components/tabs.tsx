"use client";

import { cn } from "@outegro/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import type * as React from "react";
import { createContext, use, useCallback } from "react";

/*
 * Tabs on Radix (WAI-ARIA tabs): arrow keys move between tabs, Home/End jump
 * to the ends; with activationMode="manual" focus moves and Enter/Space
 * selects. The list scrolls sideways when the tabs do not fit (360 px
 * phones), never the page, and keeps the selected tab in view.
 */

const tabsListVariants = cva(
  // inline-size containment: the row of tabs never widens its ancestors
  // (a grid column, a flex item, the page); it takes their width and scrolls.
  "relative flex w-full max-w-full items-stretch overflow-x-auto overscroll-x-contain [contain:inline-size] [scrollbar-width:thin]",
  {
    variants: {
      variant: {
        // Underlined tabs on a hairline; the line is an inset shadow, so the
        // scrolling list never clips it.
        line: "gap-1 shadow-[inset_0_-1px_0_var(--border)]",
        // Pill tabs (section navigation); the padding keeps the outside
        // focus ring inside the scrolling list.
        pill: "gap-1.5 p-1",
      },
    },
    defaultVariants: { variant: "line" },
  },
);

const tabsTriggerVariants = cva(
  // One weight in every state: the label never changes width.
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color] duration-(--duration-fast) ease-(--ease-out) select-none hover:text-foreground disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The ring is drawn inside: outside it would be cut by the list.
        line: "rounded-t-sm border-b-2 border-transparent px-3 focus-visible:-outline-offset-4 data-[state=active]:border-foreground data-[state=active]:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground",
        pill: "rounded-full border border-border bg-surface px-4 hover:border-(--border-strong) focus-visible:outline-offset-2 data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground aria-[current=page]:border-primary aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground",
      },
    },
    defaultVariants: { variant: "line" },
  },
);

type TabsVariant = NonNullable<
  VariantProps<typeof tabsListVariants>["variant"]
>;

const TabsVariantContext = createContext<TabsVariant>("line");

/**
 * Root. `variant` styles every list and tab inside: "line" (underlined, for
 * views of one thing) or "pill" (filled, for sections). Inactive panels are
 * hidden; with `forceMount` on a panel it stays mounted (keeps its state).
 */
function Tabs({
  className,
  variant = "line",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root> & {
  variant?: TabsVariant;
}) {
  return (
    <TabsVariantContext value={variant}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-variant={variant}
        className={cn("flex min-w-0 flex-col gap-4", className)}
        {...props}
      />
    </TabsVariantContext>
  );
}

/**
 * The row of tabs. Give it a name (`aria-label` or `aria-labelledby`) when
 * the page has more than one tab list or no visible heading for it.
 */
function TabsList({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const variant = use(TabsVariantContext);
  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRef(ref, node);
      if (!node) return;
      const stop = keepSelectedTabInView(node);
      return () => {
        stop();
        assignRef(ref, null);
      };
    },
    [ref],
  );
  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = use(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "min-w-0 rounded-sm data-[state=inactive]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/**
 * Scrolls a sideways-scrolling tab list (only the list, never the page) so
 * the selected tab is fully visible: at once on mount, then whenever the
 * selection changes — by click, keyboard or a value set in code.
 */
function keepSelectedTabInView(list: HTMLElement) {
  const reveal = (smooth: boolean) => {
    if (list.scrollWidth <= list.clientWidth) return;
    const tab = list.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    );
    if (!tab) return;
    // The list is positioned, so offsetLeft is measured inside it.
    const start = tab.offsetLeft;
    const end = start + tab.offsetWidth;
    const view = list.scrollLeft;
    const edge = 24; // a peek of the neighbour shows the list goes on
    let left = view;
    if (start < view) left = Math.max(0, start - edge);
    else if (end > view + list.clientWidth)
      left = end - list.clientWidth + edge;
    if (left === view) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left, behavior: smooth && !still ? "smooth" : "auto" });
  };
  reveal(false);
  const observer = new MutationObserver(() => reveal(true));
  observer.observe(list, { subtree: true, attributeFilter: ["aria-selected"] });
  return () => observer.disconnect();
}

export {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  tabsListVariants,
  tabsTriggerVariants,
};
