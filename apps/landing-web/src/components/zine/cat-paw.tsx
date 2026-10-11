"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import paw from "@/assets/zine/paw.webp";

/**
 * A cat's paw reaches in from the left edge a couple of seconds after the
 * block comes into view, shoves the first item a little off its place
 * (it stays crooked) and withdraws. Once per page view.
 */
export function CatPaw({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<
    "idle" | "reach" | "push" | "back" | "done"
  >("idle");

  useEffect(() => {
    const zone = ref.current;
    if (!zone || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timers: number[] = [];
    const at = (ms: number, next: typeof state) =>
      timers.push(window.setTimeout(() => setState(next), ms));
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        at(2200, "reach");
        at(3000, "push");
        at(3500, "back");
        at(4400, "done");
      },
      { threshold: 0.7 },
    );
    observer.observe(zone);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div ref={ref} className="paw-zone" data-paw={state}>
      {children}
      {/* biome-ignore lint/performance/noImgElement: a decorative sprite that only animates. */}
      <img
        className="paw"
        src={paw.src}
        width={paw.width}
        height={paw.height}
        alt=""
        aria-hidden="true"
        loading="lazy"
      />
    </div>
  );
}
