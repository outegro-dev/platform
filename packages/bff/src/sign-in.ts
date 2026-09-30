import { type NextRequest, NextResponse } from "next/server";
import { BackendError, createBackend } from "./backend";
import { type ClientIpSource, clientHeaders } from "./client";
import { safeRedirectPath } from "./safe-redirect";
import {
  ACCESS_COOKIE,
  clearSession,
  isSecureRequest,
  secondsLeft,
} from "./session";
import {
  beginSignIn,
  pendingCookieOptions,
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
  const returnTo = safeRedirectPath(
    request.nextUrl.searchParams.get("returnTo"),
    options.fallback,
  );
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
    if (verdict !== "refused")
      return NextResponse.redirect(new URL(returnTo, options.appUrl), 303);
    refused = true;
  }
  const { url, cookie } = beginSignIn(options.client, returnTo);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(
    SSO_COOKIE,
    cookie,
    pendingCookieOptions(isSecureRequest(request.headers, request.url)),
  );
  if (refused) clearSession(response.cookies);
  return response;
}
