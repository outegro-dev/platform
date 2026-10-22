"use client";

import { useEffect } from "react";

const IDLE_MS = 25000;

/**
 * Small pranks with no UI of their own:
 *   - leave the page alone for a while and it dozes off: the photo in the
 *     friends' form snores (html[data-dozing]); any input wakes it with a jolt;
 *   - a shout and a note for whoever opens the console.
 */
export function Mischief({ shout, note }: { shout: string; note: string }) {
  useEffect(() => {
    console.log(
      "%c %s %c\n%s",
      "font: 900 28px sans-serif; color: #fbf6e8; background: #d8382a; padding: 6px 10px;",
      shout,
      "",
      note,
    );
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let timer = 0;
    const doze = () => root.setAttribute("data-dozing", "");
    const wake = () => {
      clearTimeout(timer);
      if (root.hasAttribute("data-dozing")) {
        root.removeAttribute("data-dozing");
        root.setAttribute("data-waking", "");
        window.setTimeout(() => root.removeAttribute("data-waking"), 700);
      }
      timer = window.setTimeout(doze, IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "scroll", "wheel"];
    for (const type of events)
      window.addEventListener(type, wake, { passive: true });
    wake();
    return () => {
      clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, wake);
      root.removeAttribute("data-dozing");
    };
  }, [shout, note]);
  return null;
}
