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

type CookieWriter = {
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
