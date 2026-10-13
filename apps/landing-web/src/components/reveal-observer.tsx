"use client";

import { useLocale } from "next-intl";
import { useEffect } from "react";

/**
 * Section entrance without hiding server-rendered content:
 * elements already on screen (or scrolled past) are marked shown before
 * hiding is enabled, so only content below the fold waits for its entrance.
 * Both answers come from observers, after a frame's own layout: hydration
 * never forces one. It also lets in what the first frame leaves out under
 * the cover (zine-page.css, first-frame) once the first contentful paint is
 * out: a frame run is no sign of one, as a browser may hold its first paint.
 */
export function RevealObserver() {
  const locale = useLocale();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a language switch re-renders the sections, so re-observe them.
  useEffect(() => {
    const elements = [
      ...document.querySelectorAll<HTMLElement>("[data-reveal]"),
    ];
    const show = (el: Element) => el.setAttribute("data-shown", "");
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
    // the first answer for each: on screen or above it (a root reaching far
    // up), or still to come
    let waiting = elements.length;
    const placed = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          placed.unobserve(entry.target);
          if (entry.isIntersecting) show(entry.target);
          else observer.observe(entry.target);
          waiting--;
        }
        if (waiting === 0)
          document.documentElement.setAttribute("data-reveal-ready", "");
      },
      { rootMargin: "100000px 0px 0px 0px" },
    );
    // after the first contentful paint (a frame on where paints go
    // unreported), with everything under the cover laid out (a reload has
    // found its place by then), so each is placed where it is. An address's
    // fragment that lay in what the first frame left out had no place to
    // scroll to: the page goes there now, unless it has moved
    const root = document.documentElement;
    const place = () => {
      root.setAttribute("data-painted", "");
      for (const el of elements) placed.observe(el);
    };
    // what the first frame left out is what still waits on its first-frame
    // animation, in page order. Out of sight under the cover of a page at
    // its top, it comes in a block a frame: each is laid out in a task of
    // its own rather than all of them in one long one
    let blocks: CSSAnimation[] = [];
    const unveil = () => {
      const block = blocks.shift();
      if (!block) {
        place();
        return;
      }
      block.finish();
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(unveil);
      });
    };
    const settle = () => {
      const painted = root.hasAttribute("data-painted");
      // asked before anything changes: the scroll is read off a clean layout
      const fragment =
        !painted && window.location.hash && window.scrollY === 0
          ? document.getElementById(window.location.hash.slice(1))
          : null;
      if (painted || fragment || window.scrollY > 0) {
        place();
        fragment?.scrollIntoView({ behavior: "instant" });
        return;
      }
      blocks = document
        .getAnimations()
        .filter(
          (animation): animation is CSSAnimation =>
            animation instanceof CSSAnimation &&
            animation.animationName === "first-frame",
        );
      unveil();
    };
    let timer = 0;
    let frame = 0;
    const paints = new PerformanceObserver((list) => {
      if (!list.getEntriesByName("first-contentful-paint").length) return;
      paints.disconnect();
      timer = window.setTimeout(settle);
    });
    if (PerformanceObserver.supportedEntryTypes.includes("paint"))
      paints.observe({ type: "paint", buffered: true });
    else
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(settle);
      });
    return () => {
      paints.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      placed.disconnect();
      observer.disconnect();
    };
  }, [locale]);
  return null;
}
