import { useSyncExternalStore } from "react";

/*
 * The browser behind small interfaces: storage, the connection, keys. The
 * reader's stores get these through their constructors (never touching
 * navigator or localStorage themselves), so tests swap them for fakes.
 */

/** A string store that may refuse (private mode, storage disabled). */
export type KeyValueStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
};

/** This browser's localStorage; a refusal only means nothing is kept. */
export const browserStorage: KeyValueStorage = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode or storage disabled: the value lasts for this page.
    }
  },
};

/** navigator.onLine, true where it is unknown (the server, tests). */
export const browserIsOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;

/** Checked before an action starts: offline, it is explained at once. */
export const isOffline = () => !browserIsOnline();

/**
 * A fresh Idempotency-Key: a version 4 UUID, as edu-backend expects.
 * randomUUID exists only in secure contexts (HTTPS, localhost); a plain
 * http preview builds the same UUID from getRandomValues.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4),
    hex.slice(4, 6),
    hex.slice(6, 8),
    hex.slice(8, 10),
    hex.slice(10, 16),
  ]
    .map((part) => part.join(""))
    .join("-");
}

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
