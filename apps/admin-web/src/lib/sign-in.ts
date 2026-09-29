import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import {
  ACCESS_COOKIE,
  clearSession,
  isSecureRequest,
  secondsLeft,
} from "@outegro/bff/session";
import {
  beginSignIn,
  pendingCookieOptions,
  SSO_COOKIE,
} from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import type { Operator } from "./adapters/identity";
import { SEEN_COOKIE } from "./idle";
import type { Loaded } from "./result";
import { appUrl, ssoClient } from "./session";

export type SignInDeps = {
  /** The operator, fresh from Identity with this request's session (`getOperator`). */
  operator: () => Promise<Loaded<Operator>>;
  now?: () => number;
};

/** The proxy's margin: a token this close to its expiry gets refreshed. */
const FRESH_SECONDS = 30;

/**
 * `/auth/sign-in?returnTo=…`: starts sign-in through id.outegro.dev
 * (authorization code with PKCE): state, verifier and the return path go
 * into a short-lived HttpOnly cookie, the browser goes to /authorize.
 *
 * Pages send the operator here when Identity refuses their session, and
 * an access cookie that has not expired proves nothing then: the session
 * may have been revoked elsewhere or the account suspended, while the
 * token has minutes left. So Identity is asked first. A session it accepts
 * goes straight back (a stale link to sign-in); one it refuses is dropped
 * with all its cookies and sign-in starts, once, instead of bouncing
 * between the page and this route until the cookie expires.
 */
export async function startSignIn(
  request: NextRequest,
  deps: SignInDeps,
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
    "/",
  );
  const now = deps.now?.() ?? Date.now();
  let refused = false;
  if (
    secondsLeft(request.cookies.get(ACCESS_COOKIE)?.value, now) > FRESH_SECONDS
  ) {
    const me = await deps.operator();
    // Accepted, or Identity cannot tell now: the page shows what it knows.
    if (me.ok || me.kind !== "unauthenticated")
      return NextResponse.redirect(appUrl(returnTo), 303);
    refused = true;
  }
  const { url, cookie } = beginSignIn(ssoClient, returnTo);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(
    SSO_COOKIE,
    cookie,
    pendingCookieOptions(isSecureRequest(request.headers, request.url)),
  );
  if (refused) {
    clearSession(response.cookies);
    response.cookies.delete(SEEN_COOKIE);
  }
  return response;
}
