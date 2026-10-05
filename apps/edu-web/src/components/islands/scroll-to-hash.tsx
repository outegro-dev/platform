"use client";

import { useEffect } from "react";

/** Room left above the place a link points at (as scroll-margin gives anchors). */
const SETTLED = 80;

/** The document's own opening was handled: client navigations scroll by themselves. */
let opened = false;

function hashId(): string | null {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) || null;
  } catch {
    return null;
  }
}

/**
 * A link from elsewhere to a place in a reading page (an exercise, a
 * section, "explain it in your own words"): the page streams in behind its
 * skeleton, so the browser cannot scroll to the place when the document
 * opens. Once the page is in place, this goes there, at once (no animation
 * over a long chapter). Only for the page the document opened with: the
 * router scrolls on its own navigations, and going back restores where the
 * reader was.
 */
export function ScrollToHash() {
  useEffect(() => {
    if (opened) return;
    opened = true;
    const id = hashId();
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const top = target.getBoundingClientRect().top;
    if (top >= 0 && top < SETTLED) return;
    target.scrollIntoView({ block: "start", behavior: "instant" });
  }, []);
  return null;
}
