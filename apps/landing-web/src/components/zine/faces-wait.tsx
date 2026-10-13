"use client";

import { useSyncExternalStore } from "react";

const reported = () =>
  PerformanceObserver.supportedEntryTypes.includes("paint");
// a hidden page paints nothing, so it has no first paint to keep clear
const ready = () =>
  document.visibilityState === "hidden" ||
  (reported()
    ? performance.getEntriesByName("first-contentful-paint").length > 0
    : document.readyState === "complete");

let held = true;
// once let go, for good: a page shown again before its first paint keeps
// the faces it fetched while hidden rather than going back to fallbacks
const released = () => {
  if (held && ready()) held = false;
  return !held;
};
const subscribe = (change: () => void) => {
  const paints = new PerformanceObserver(change);
  if (reported()) paints.observe({ type: "paint", buffered: true });
  document.addEventListener("readystatechange", change);
  document.addEventListener("visibilitychange", change);
  return () => {
    paints.disconnect();
    document.removeEventListener("readystatechange", change);
    document.removeEventListener("visibilitychange", change);
  };
};
const serving = () => false;

/**
 * LateFaces' marker, rendered by the server and hydration and gone once the
 * page has painted, been hidden or (where paints go unreported) loaded; no
 * render after that does, so a soft navigation never holds the faces. Its
 * attribute is what zine-page.css holds them on, and LateFaces' script takes
 * it off at the paint itself, ahead of hydration, which is told not to mind.
 */
export function FacesWait() {
  const done = useSyncExternalStore(subscribe, released, serving);
  return done ? null : (
    <span hidden data-faces-wait="" suppressHydrationWarning />
  );
}
