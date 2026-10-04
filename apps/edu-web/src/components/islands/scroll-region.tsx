"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A box that scrolls when its content does not fit (a diagram or a table on
 * a phone, a long result). Only while it actually overflows does it join
 * the tab order, with a name, so keyboard users can scroll it; otherwise it
 * is a plain box and adds no tab stop.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      setOverflowing(
        node.scrollWidth > node.clientWidth + 1 ||
          node.scrollHeight > node.clientHeight + 1,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: the label comes with role="group", both only while the box scrolls
    <div
      ref={ref}
      className={className}
      tabIndex={overflowing ? 0 : undefined}
      role={overflowing ? "group" : undefined}
      aria-label={overflowing ? label : undefined}
    >
      {children}
    </div>
  );
}
