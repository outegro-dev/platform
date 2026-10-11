"use client";

import { type RefObject, useEffect, useState } from "react";

/**
 * "static" until hydration (server markup shows the finished state), then
 * "armed" while the element waits below the fold and "play" once it is in
 * view. Elements already on screen, reduced motion and no IntersectionObserver
 * stay "static", so nothing ever hides content that is already visible.
 */
export function useOnView(
  ref: RefObject<HTMLElement | null>,
  { threshold = 0.5, delay = 0 } = {},
) {
  const [state, setState] = useState<"static" | "armed" | "play">("static");
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight * 0.9) return;
    setState("armed");
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        timer = window.setTimeout(() => setState("play"), delay);
      },
      { threshold },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [ref, threshold, delay]);
  return state;
}
