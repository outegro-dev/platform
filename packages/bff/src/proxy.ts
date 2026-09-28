import type { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  clearSession,
  isSecureRequest,
  REFRESH_COOKIE,
  type SessionTokens,
  secondsLeft,
  writeSession,
} from "./session.js";

export type RefreshOutcome =
  | "fresh"
  | "refreshed"
  | "signed-out"
  | "anonymous"
  | "unavailable";

/**
 * Keeps the session usable before any page or server action runs: when the
 * access token is missing or about to expire, rotate the refresh token once
 * and hand the new cookies to both the response and this request.
 * Parallel requests are safe: Identity returns the same new token to
 * concurrent callers inside its grace window (ADR-004).
 */
export async function refreshSession(
  request: NextRequest,
  authApiUrl: string,
): Promise<{
  outcome: RefreshOutcome;
  apply: (response: NextResponse) => NextResponse;
}> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const noop = (response: NextResponse) => response;
  if (secondsLeft(access) > 30) return { outcome: "fresh", apply: noop };
  if (!refresh) return { outcome: "anonymous", apply: noop };

  let result: Response;
  try {
    result = await fetch(`${authApiUrl}/v1/sessions/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Keep the cookies: a later request can still refresh once Identity is back.
    return { outcome: "unavailable", apply: noop };
  }
  const secure = isSecureRequest(request.headers, request.url);
  if (!result.ok) {
    if (result.status >= 500) return { outcome: "unavailable", apply: noop };
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    return {
      outcome: "signed-out",
      apply: (response) => {
        clearSession(response.cookies);
        return response;
      },
    };
  }
  const tokens = (await result.json()) as SessionTokens;
  request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  return {
    outcome: "refreshed",
    apply: (response) => {
      writeSession(response.cookies, tokens, secure);
      return response;
    },
  };
}
