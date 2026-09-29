/**
 * Idle sign-out (chapter 7.8: the console session is shorter than a regular
 * account). The browser warns two minutes ahead and signs out after 30 idle
 * minutes; the server keeps the time of the last request in `og_admin_seen`
 * and ends a session idle for longer than that plus a short grace, even if
 * the tab was closed or asleep. Shared by the proxy and the browser.
 */
export const IDLE_TIMEOUT_MS = 30 * 60_000;
export const IDLE_WARNING_MS = 2 * 60_000;
export const SERVER_IDLE_LIMIT_MS = IDLE_TIMEOUT_MS + 2 * 60_000;
/** The browser tells the server about activity at most this often. */
export const KEEPALIVE_INTERVAL_MS = 60_000;
export const SEEN_COOKIE = "og_admin_seen";

export function seenCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Idle for longer than the server limit (a missing stamp is not idle). */
export function isIdle(seen: string | undefined, now = Date.now()): boolean {
  const at = Number(seen);
  return (
    Number.isFinite(at) && at > 0 && now - at * 1000 > SERVER_IDLE_LIMIT_MS
  );
}

export const nowSeconds = (now = Date.now()) => String(Math.floor(now / 1000));
