"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A window's body that scrolls once the window stops at the taskbar (short
 * wide screens, desktop.css). Only then is it a tab stop, named, so the
 * keyboard can scroll it; while all of it shows, the keyboard passes it by.
 */
export function ScrollBody({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children: React.ReactNode;
}) {
  const body = useRef<HTMLElement>(null);
  const [scrolls, setScrolls] = useState(false);

  useEffect(() => {
    const element = body.current;
    if (!element) return;
    // the body's own size, and its content's: either may change the overflow
    const observer = new ResizeObserver(() =>
      setScrolls(element.scrollHeight > element.clientHeight),
    );
    for (const box of [element, ...element.children]) observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={body}
      className={className}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
    >
      {children}
    </section>
  );
}
