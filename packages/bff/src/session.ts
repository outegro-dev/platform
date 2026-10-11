/**
 * Session cookies of a platform frontend. Host-only (no Domain), HttpOnly,
 * SameSite=Lax, Secure over HTTPS: every app keeps its own session, and
 * JavaScript never sees a token.
 */

export const ACCESS_COOKIE = "og_at";
export const REFRESH_COOKIE = "og_rt";

export type SessionTokens = {
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

export type CookieWriter = {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
};

export function sessionCookieOptions(secure: boolean, expires: Date) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export function writeSession(
  cookies: CookieWriter,
  tokens: SessionTokens,
  secure: boolean,
) {
  cookies.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    sessionCookieOptions(secure, new Date(tokens.accessTokenExpiresAt)),
  );
  cookies.set(
    REFRESH_COOKIE,
    tokens.refreshToken,
    sessionCookieOptions(secure, new Date(tokens.refreshTokenExpiresAt)),
  );
}

export function clearSession(cookies: CookieWriter) {
  cookies.delete(ACCESS_COOKIE);
  cookies.delete(REFRESH_COOKIE);
}

/**
 * The platform's sign-in hint: "this browser has a session at
 * id.outegro.dev". Not a credential and no data (the value is "1"): only
 * Identity's frontend writes it, on the parent domain, for as long as its
 * own session lives, so another app can try silent sign-in for a visitor it
 * has no session for, and does nothing for everyone else. Anyone on the
 * domain could set or drop it; the worst they get is one round trip to
 * /authorize, which decides on Identity's own session.
 */
export const HINT_COOKIE = "og_hint";

/**
 * Where the hint lives: the parent domain of Identity's host
 * (id.outegro.dev → outegro.dev), shared by every app of the platform.
 * None for localhost or an IP address: a host-only cookie there already
 * reaches the other apps, cookies ignore the port.
 */
export function hintDomain(idUrl: string): string | undefined {
  const { hostname } = new URL(idUrl);
  if (hostname.includes(":") || /^[\d.]+$/.test(hostname)) return undefined;
  const labels = hostname.split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : undefined;
}

export function hintCookieOptions(
  secure: boolean,
  domain: string | undefined,
  expires: Date,
) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    expires,
    ...(domain ? { domain } : {}),
  };
}

/** Next to Identity's own session, ending with it. */
export function writeHint(
  cookies: CookieWriter,
  tokens: Pick<SessionTokens, "refreshTokenExpiresAt">,
  secure: boolean,
  domain: string | undefined,
) {
  cookies.set(
    HINT_COOKIE,
    "1",
    hintCookieOptions(secure, domain, new Date(tokens.refreshTokenExpiresAt)),
  );
}

/** A cookie on a domain is only deleted with that same domain and path. */
export function clearHint(
  cookies: CookieWriter,
  secure: boolean,
  domain: string | undefined,
) {
  cookies.set(HINT_COOKIE, "", hintCookieOptions(secure, domain, new Date(0)));
}

/**
 * What an app that signs in silently remembers about it in this browser,
 * host-only:
 * - `tried`: an attempt was made; no other one for a few minutes (no
 *   loops, one round trip at most), or for a day after one that would only
 *   fail the same way again (see `finishSignIn`);
 * - `out`: the person signed out here, or Identity refused this app's
 *   session (revoked): never undone silently, only by signing in here;
 * - `silent`: this app's session came from silent sign-in, nobody asked for
 *   it here, so it ends together with the session at id.outegro.dev (see
 *   `refreshSession`).
 * A session that simply expired leaves nothing behind (or `silent`): the
 * next visit picks up the session at id.outegro.dev again.
 */
export const SILENT_COOKIE = "og_silent";
export type SilentMark = "tried" | "out" | "silent";
/** The wait after a silent attempt that would fail the same way again (a suspended account, a misconfigured client). */
export const SILENT_FAILED_SECONDS = 24 * 3600;
const SILENT_SECONDS: Record<SilentMark, number> = {
  tried: 300,
  out: 365 * 24 * 3600,
  silent: 365 * 24 * 3600,
};

export function markSilent(
  cookies: CookieWriter,
  value: SilentMark,
  secure: boolean,
  maxAge = SILENT_SECONDS[value],
) {
  cookies.set(SILENT_COOKIE, value, {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  });
}

/**
 * Whether silent sign-in waits in this browser: after an attempt or a
 * sign-out, and for any value it does not know. Only `silent` lets it
 * start again, once that session is gone.
 */
export function silentWaits(mark: string | undefined) {
  return mark !== undefined && mark !== "silent";
}

/** Seconds until a JWT expires, from its payload (no verification: cookie is ours). */
export function secondsLeft(token: string | undefined, now = Date.now()) {
  if (!token) return 0;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { exp?: number };
    return payload.exp ? payload.exp - Math.floor(now / 1000) : 0;
  } catch {
    return 0;
  }
}

/** HTTPS as seen by the app behind Traefik. */
export function isSecureRequest(
  headers: { get(name: string): string | null },
  url: string,
) {
  return (
    headers.get("x-forwarded-proto") === "https" || url.startsWith("https:")
  );
}
