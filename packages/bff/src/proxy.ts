import { type NextRequest, NextResponse } from "next/server";
import { type ClientIpSource, clientHeaders } from "./client";
import {
  ACCESS_COOKIE,
  clearHint,
  clearSession,
  HINT_COOKIE,
  isSecureRequest,
  markSilent,
  REFRESH_COOKIE,
  type SessionTokens,
  SILENT_COOKIE,
  secondsLeft,
  silentWaits,
  writeHint,
  writeSession,
} from "./session";
import { endSession } from "./sso";

export type RefreshOutcome =
  | "fresh"
  | "refreshed"
  | "signed-out"
  | "anonymous"
  | "unavailable";

export type RefreshOptions = {
  clientIpSource?: ClientIpSource;
  /**
   * Identity's own frontend only: keep HINT_COOKIE in step with its
   * session, written with every rotation and dropped once it is gone.
   */
  hint?: { domain: string | undefined };
  /**
   * An app that signs in silently (`silentSignIn`): a session that came
   * from silent sign-in ends once the hint is gone (signed out at
   * id.outegro.dev), and one Identity refuses is not re-established
   * silently (see SILENT_COOKIE).
   */
  silent?: boolean;
};

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
  options: RefreshOptions = {},
): Promise<{
  outcome: RefreshOutcome;
  apply: (response: NextResponse) => NextResponse;
}> {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  const secure = isSecureRequest(request.headers, request.url);
  const { hint } = options;
  const hinted = request.cookies.has(HINT_COOKIE);
  const mark = request.cookies.get(SILENT_COOKIE)?.value;
  const result = (
    outcome: RefreshOutcome,
    write?: (response: NextResponse) => void,
  ) => ({
    outcome,
    apply: (response: NextResponse) => {
      write?.(response);
      return response;
    },
  });

  // Nobody asked for a silent session here: on a shared computer it must
  // not outlive the sign-out at id.outegro.dev, which drops the hint.
  if (options.silent && mark === "silent" && !hinted && (access || refresh)) {
    await endSession(
      authApiUrl,
      refresh,
      clientHeaders(request.headers, options.clientIpSource),
    );
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    return result("signed-out", (response) => {
      clearSession(response.cookies);
      response.cookies.delete(SILENT_COOKIE);
    });
  }
  // A session from before the hint existed rotates once: the hint ends
  // with the session, and only a rotation tells when that is.
  const fresh = secondsLeft(access) > 30;
  if (fresh && !(hint && !hinted && refresh)) return result("fresh");
  if (!refresh)
    return result(
      "anonymous",
      hint && hinted
        ? (response) => clearHint(response.cookies, secure, hint.domain)
        : undefined,
    );

  let answer: Response;
  try {
    answer = await fetch(`${authApiUrl}/v1/sessions/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...clientHeaders(request.headers, options.clientIpSource),
      },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Keep the cookies: a later request can still refresh once Identity is back.
    return result(fresh ? "fresh" : "unavailable");
  }
  if (!answer.ok) {
    if (answer.status >= 500) return result(fresh ? "fresh" : "unavailable");
    request.cookies.delete(ACCESS_COOKIE);
    request.cookies.delete(REFRESH_COOKIE);
    if (options.silent) request.cookies.set(SILENT_COOKIE, "out");
    return result("signed-out", (response) => {
      clearSession(response.cookies);
      if (hint && hinted) clearHint(response.cookies, secure, hint.domain);
      // Revoked or suspended: the session at id.outegro.dev does not bring it back.
      if (options.silent) markSilent(response.cookies, "out", secure);
    });
  }
  const tokens = (await answer.json()) as SessionTokens;
  request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  return result("refreshed", (response) => {
    writeSession(response.cookies, tokens, secure);
    if (hint) writeHint(response.cookies, tokens, secure, hint.domain);
    // The mark lives as long as the session it describes.
    if (options.silent && mark === "silent")
      markSilent(response.cookies, "silent", secure);
  });
}

/** Crawlers and link unfurlers are never sent anywhere, whatever they carry. */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview/i;

/** Where silent sign-in never starts: the SSO round trip itself, and JSON. */
const NOT_PAGES = ["/auth", "/api"];

/**
 * A person opening a page, as opposed to anything a page or the browser
 * fetches on its own: a GET for a top-level document (Fetch Metadata, or an
 * HTML Accept from browsers without it); not a prefetch or prerender, a
 * frame, a script or the router's fetch; not a crawler.
 */
function isPageVisit(request: NextRequest) {
  const { headers } = request;
  if (request.method !== "GET") return false;
  const agent = headers.get("user-agent");
  if (!agent || BOT.test(agent)) return false;
  if (headers.has("sec-purpose") || headers.has("purpose")) return false;
  const mode = headers.get("sec-fetch-mode");
  const dest = headers.get("sec-fetch-dest");
  if (mode !== null || dest !== null)
    return mode === "navigate" && dest === "document";
  return (headers.get("accept") ?? "").includes("text/html");
}

/**
 * Silent sign-in: a visitor this app has no session for, whose browser has
 * one at id.outegro.dev (HINT_COOKIE), goes through this app's
 * `/auth/sign-in?silent=1` and comes back to the same page, signed in, or
 * signed out when Identity has no session after all. Returns that redirect,
 * or null to go on as usual.
 *
 * Nothing happens without the hint (anonymous visitors and crawlers cost
 * nothing), after a recent attempt, a sign-out here or a session Identity
 * refused (SILENT_COOKIE), for anything but a page visit, on the SSO routes
 * and the API, or while Identity is unreachable. The sign-in route checks
 * the cookies again, so a crafted link cannot loop either.
 */
export function silentSignIn(
  request: NextRequest,
  outcome: RefreshOutcome,
  appUrl: string,
): NextResponse | null {
  if (outcome !== "anonymous" && outcome !== "signed-out") return null;
  if (
    !request.cookies.has(HINT_COOKIE) ||
    silentWaits(request.cookies.get(SILENT_COOKIE)?.value)
  )
    return null;
  const { pathname, search } = request.nextUrl;
  const skipped = NOT_PAGES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (skipped || !isPageVisit(request)) return null;
  const target = new URL("/auth/sign-in", appUrl);
  target.searchParams.set("returnTo", `${pathname}${search}`);
  target.searchParams.set("silent", "1");
  const response = NextResponse.redirect(target, 303);
  // It depends on cookies: no shared cache may keep it for anyone else.
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
