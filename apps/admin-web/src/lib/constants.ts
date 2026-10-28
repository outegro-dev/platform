/** Request header set by src/proxy.ts: the requested path, for return-after-sign-in. */
export const PATH_HEADER = "x-admin-path";

/** The operator's IANA time zone, written by the browser (TimezoneSync). */
export const TZ_COOKIE = "og_tz";

/**
 * Marks a request the page makes on its own (the roulette's live table,
 * every few seconds): src/proxy.ts does not count it as operator activity,
 * so an open live page never keeps an idle session alive.
 */
export const BACKGROUND_HEADER = "x-admin-background";

/** Message namespaces client components read; the rest stays on the server. */
export const CLIENT_NAMESPACES: readonly string[] = [
  "common",
  "actions",
  "idle",
  "shell",
  "replay",
];
