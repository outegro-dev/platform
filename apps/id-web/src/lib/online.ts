import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The browser's connection state; the server always renders "online". */
export function useOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Checked before an action starts: an offline submit would only fail after a
 * network timeout, so it is stopped and explained right away instead.
 */
export function isOffline() {
  return typeof navigator !== "undefined" && !navigator.onLine;
}
