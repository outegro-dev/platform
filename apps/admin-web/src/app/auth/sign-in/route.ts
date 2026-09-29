import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import {
  ACCESS_COOKIE,
  isSecureRequest,
  secondsLeft,
} from "@outegro/bff/session";
import {
  beginSignIn,
  pendingCookieOptions,
  SSO_COOKIE,
} from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { appUrl, ssoClient } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Starts sign-in through id.outegro.dev (authorization code with PKCE):
 * remember state, verifier and the return path in a short-lived HttpOnly
 * cookie, then go to /authorize.
 */
export function GET(request: NextRequest) {
  const returnTo = safeRedirectPath(
    request.nextUrl.searchParams.get("returnTo"),
    "/",
  );
  if (secondsLeft(request.cookies.get(ACCESS_COOKIE)?.value) > 30) {
    return NextResponse.redirect(appUrl(returnTo), 303);
  }
  const { url, cookie } = beginSignIn(ssoClient, returnTo);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(
    SSO_COOKIE,
    cookie,
    pendingCookieOptions(isSecureRequest(request.headers, request.url)),
  );
  return response;
}
