import { useSyncExternalStore } from "react";

/** navigator.onLine, true where it is unknown (the server, tests). */
export const browserIsOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/** Checked before an action starts: offline, it is explained at once. */
export const isOffline = () => !browserIsOnline();

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The connection state for rendering; the server always renders "online". */
export function useOnline() {
  return useSyncExternalStore(subscribe, browserIsOnline, () => true);
}

/** Focus is in a field where letters are typed: keyboard shortcuts stay out. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
