"use client";

import { useSyncExternalStore } from "react";

const subscribe = (change: () => void) => {
  document.addEventListener("readystatechange", change);
  return () => document.removeEventListener("readystatechange", change);
};
const loaded = () => document.readyState === "complete";
const serving = () => false;

/**
 * Holds the faces the home page's first screen does not set until the page
 * has loaded: zine-page.css keeps them on their fallbacks while this marker
 * is in the page. The server and hydration render it; a soft navigation
 * after the load never does, so the faces in use do not blink back.
 */
export function LateFaces() {
  const done = useSyncExternalStore(subscribe, loaded, serving);
  return done ? null : <span hidden data-faces-wait="" />;
}
