"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

/**
 * A picture that mounts only once its box comes near the screen, `ahead`
 * of it as an IntersectionObserver rootMargin. Native lazy loading reaches
 * a few screens down, and the first layout is short (the issue lies open
 * until its flight takes over), so pictures far down the page came with
 * the first screen. Meanwhile the box keeps the picture's size (its class
 * sets it) and, given the picture's `label`, stands in for it as an image
 * of that name once hydrated; without scripting the picture in <noscript>
 * shows instead.
 */
export function WhenNear({
  className,
  ahead = "100% 0px",
  label,
  children,
}: {
  className: string;
  ahead?: string;
  label?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"served" | "waiting" | "near">("served");

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    setState((now) => (now === "near" ? now : "waiting"));
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) near();
      },
      { rootMargin: ahead },
    );
    // a printout is the whole page, near or not: the picture goes in before
    // the sheets are laid out, which happens straight after this event
    const print = () => flushSync(near);
    const near = () => {
      observer.disconnect();
      window.removeEventListener("beforeprint", print);
      setState("near");
    };
    observer.observe(box);
    window.addEventListener("beforeprint", print);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeprint", print);
    };
  }, [ahead]);

  if (state === "near")
    return (
      <span ref={ref} className={className}>
        {children}
      </span>
    );
  const fallback = <noscript>{children}</noscript>;
  return label && state === "waiting" ? (
    <span ref={ref} className={className} role="img" aria-label={label}>
      {fallback}
    </span>
  ) : (
    <span ref={ref} className={className}>
      {fallback}
    </span>
  );
}
