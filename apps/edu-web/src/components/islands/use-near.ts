"use client";

import { type RefObject, useEffect } from "react";

/**
 * Calls `onNear` once, when the element first comes within a screen of
 * the viewport (generous, so its work is done by the time the reader gets
 * there). An element that is not rendered (an explanation tab not shown)
 * is never near; it counts once its tab is shown. Never called on the
 * server, nor for elements the reader never approaches.
 */
export function useWhenNear(
  ref: RefObject<Element | null>,
  onNear: () => void,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        onNear();
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, onNear]);
}
