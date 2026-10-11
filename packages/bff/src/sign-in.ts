import { type NextRequest, NextResponse } from "next/server";
import { BackendError, createBackend } from "./backend";
import { type ClientIpSource, clientHeaders } from "./client";
import { safeRedirectPath } from "./safe-redirect";
import {
  ACCESS_COOKIE,
  clearSession,
  HINT_COOKIE,
  isSecureRequest,
  markSilent,
  SILENT_COOKIE,
  SILENT_FAILED_SECONDS,
  secondsLeft,
  silentWaits,
  writeSession,
} from "./session";
import {
  beginSignIn,
  completeSignIn,
  decodePending,
  pendingCookieOptions,
  type SignInFailure,
  SSO_COOKIE,
  type SsoClient,
} from "./sso";

/** Identity's word on a session: accepted, refused (401), or unknown right now. */
export type SessionVerdict = "accepted" | "refused" | "unknown";

/** The proxy's margin: a token this close to its expiry gets refreshed. */
const FRESH_SECONDS = 30;

/**
 * Asks Identity (`GET /v1/me`) whether it still accepts an access token.
 * Only a 401 is a refusal: an outage, a timeout or any other answer says
 * nothing about the session.
 */
export async function askIdentity(
  authApiUrl: string,
  accessToken: string,
  incoming: Headers,
  clientIpSource?: ClientIpSource,
): Promise<SessionVerdict> {
  const forwarded = clientHeaders(incoming, clientIpSource);
  try {
    await createBackend(authApiUrl, { headers: () => forwarded })("/v1/me", {
      accessToken,
      timeoutMs: 3000,
    });
    return "accepted";
  } catch (error) {
    return error instanceof BackendError && error.status === 401
      ? "refused"
      : "unknown";
  }
}

export type SignInOptions = {
  /** This app as an SSO client of id.outegro.dev. */
  client: SsoClient;
  /** Public origin of this app (APP_URL): the only place to go back to. */
  appUrl: string;
  /** Where to return without a usable `returnTo`. */
  fallback: string;
  clientIpSource?: ClientIpSource;
  now?: () => number;
};

/**
 * `GET /auth/sign-in?returnTo=…` of a platform app: starts sign-in through
 * id.outegro.dev (authorization code with PKCE): state, verifier and the
 * return path go into a short-lived HttpOnly cookie, the browser goes to
 * /authorize.
 *
 * Pages send the visitor here when a service refuses their session, and an
 * access cookie that has not expired proves nothing then: the session may
 * have been revoked elsewhere or the account suspended while the token has
 * minutes left. So Identity is asked first. A session it accepts goes
 * straight back (a stale link to sign-in, a second tab); one it refuses is
 * dropped and sign-in starts, once, instead of bouncing between the page
 * and this route until the cookie expires. When Identity cannot tell, the
 * cookies stay and the page shows what it knows ("unavailable").
 *
 * `silent=1` comes from `silentSignIn` in the proxy: Identity is asked
 * without its sign-in page, and SILENT_COOKIE is set to "tried" so the
 * attempt is not repeated for a while, whatever its result. Without the
 * hint, or while that cookie says to wait (a stale or crafted link), the
 * visitor just goes back to `returnTo`.
 */
export async function startSignIn(
  request: NextRequest,
  options: SignInOptions,
): Promise<NextResponse> {
  // Sign-in leaves this origin, where a fetch cannot follow (connect-src
  // 'self', no CORS at id.outegro.dev). A page that redirects here during a
  // client-side navigation makes the router fetch this URL: an empty answer
  // has it load the URL as a document instead, and only that request acts.
  if ((request.headers.get("sec-fetch-dest") ?? "document") !== "document")
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  const params = request.nextUrl.searchParams;
  const returnTo = safeRedirectPath(params.get("returnTo"), options.fallback);
  const back = () =>
    NextResponse.redirect(new URL(returnTo, options.appUrl), 303);
  const silent = params.get("silent") === "1";
  if (
    silent &&
    (!request.cookies.has(HINT_COOKIE) ||
      silentWaits(request.cookies.get(SILENT_COOKIE)?.value))
  )
    return back();
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const now = options.now?.() ?? Date.now();
  let refused = false;
  if (access && secondsLeft(access, now) > FRESH_SECONDS) {
    const verdict = await askIdentity(
      options.client.authApiUrl,
      access,
      request.headers,
      options.clientIpSource,
    );
    if (verdict !== "refused") return back();
    refused = true;
  }
  const secure = isSecureRequest(request.headers, request.url);
  const { url, cookie } = beginSignIn(options.client, returnTo, { silent });
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(SSO_COOKIE, cookie, pendingCookieOptions(secure));
  if (silent) markSilent(response.cookies, "tried", secure);
  if (refused) clearSession(response.cookies);
  return response;
}

export type CallbackOptions = {
  client: SsoClient;
  /** Public origin of this app (APP_URL). */
  appUrl: string;
  /** This app's start page. */
  fallback: string;
  /** Where a failed sign-in the visitor asked for explains itself. */
  errorPath: (reason: SignInFailure) => string;
  clientIpSource?: ClientIpSource;
};

/**
 * `GET /auth/callback` of an app that signs in silently: back from
 * id.outegro.dev, check the state, swap the code for this app's own session
 * (server to server) and return where sign-in started. The pending sign-in
 * cookie is deleted, with one exception below.
 *
 * A session that came from a silent attempt is marked `silent` (it ends
 * with the session at id.outegro.dev); one the visitor asked for clears any
 * mark, so a sign-out here before it no longer stands in the way.
 *
 * A silent attempt that fails (no session at Identity, a refused code, an
 * outage) lands on its page signed out, without an error page: the visitor
 * never asked to sign in. One that would only fail the same way again (a
 * refused request or code, not a missing session or an outage) waits a day
 * before the next one. Tabs restored together start parallel silent
 * attempts that share one pending cookie, and only the last one matches:
 * a callback that matches nothing while an attempt is under way or the
 * browser is already signed in lands on the start page and leaves the
 * cookie to the attempt it belongs to, unless that cookie is a sign-in the
 * visitor asked for (then the error page explains, as before).
 */
export async function finishSignIn(
  request: NextRequest,
  options: CallbackOptions,
): Promise<NextResponse> {
  const pending = request.cookies.get(SSO_COOKIE)?.value;
  const result = await completeSignIn(
    options.client,
    request.nextUrl.searchParams,
    pending,
    clientHeaders(request.headers, options.clientIpSource),
  );
  const secure = isSecureRequest(request.headers, request.url);
  const to = (path: string) =>
    NextResponse.redirect(new URL(path, options.appUrl), 303);
  if (
    !result.ok &&
    result.reason === "state_mismatch" &&
    decodePending(pending)?.silent !== false &&
    (request.cookies.get(SILENT_COOKIE)?.value === "tried" ||
      request.cookies.has(ACCESS_COOKIE))
  )
    return to(options.fallback);
  const response = result.ok
    ? to(result.returnTo)
    : to(result.silent ? result.returnTo : options.errorPath(result.reason));
  if (result.ok) {
    writeSession(response.cookies, result.tokens, secure);
    if (result.silent) markSilent(response.cookies, "silent", secure);
    else if (request.cookies.has(SILENT_COOKIE))
      response.cookies.delete(SILENT_COOKIE);
  } else if (
    result.silent &&
    result.reason !== "login_required" &&
    result.reason !== "unavailable"
  ) {
    markSilent(response.cookies, "tried", secure, SILENT_FAILED_SECONDS);
  }
  response.cookies.delete(SSO_COOKIE);
  return response;
}
