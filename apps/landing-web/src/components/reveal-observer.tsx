"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";

/**
 * Section entrance without hiding server-rendered content:
 * elements already on screen are marked shown before hiding is enabled,
 * so only content below the fold waits for its entrance.
 */
export function RevealObserver() {
  const locale = useLocale();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a language switch re-renders the sections, so re-observe them.
  useEffect(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>("[data-reveal]"),
    ];
    const show = (el: Element) => el.setAttribute("data-shown", "");
    for (const el of elements) {
      if (el.getBoundingClientRect().top < window.innerHeight) show(el);
    }
    document.documentElement.setAttribute("data-reveal-ready", "");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    for (const el of elements)
      if (!el.hasAttribute("data-shown")) observer.observe(el);
    return () => observer.disconnect();
  }, [locale]);
  return null;
}
