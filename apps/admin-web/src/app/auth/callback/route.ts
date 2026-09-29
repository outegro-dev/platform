import { clientHeaders } from "@outegro/bff/client";
import { isSecureRequest, writeSession } from "@outegro/bff/session";
import { completeSignIn, SSO_COOKIE } from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { nowSeconds, SEEN_COOKIE, seenCookieOptions } from "@/lib/idle";
import { appUrl, ssoClient } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Back from id.outegro.dev: check the state, swap the code for this
 * console's own session (server to server), then return where sign-in
 * started. The pending sign-in cookie is deleted whatever happens.
 */
export async function GET(request: NextRequest) {
  const result = await completeSignIn(
    ssoClient,
    request.nextUrl.searchParams,
    request.cookies.get(SSO_COOKIE)?.value,
    clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
  );
  const secure = isSecureRequest(request.headers, request.url);
  const response = NextResponse.redirect(
    result.ok
      ? appUrl(result.returnTo)
      : appUrl(`/sign-in?error=${result.reason}`),
    303,
  );
  if (result.ok) {
    writeSession(response.cookies, result.tokens, secure);
    response.cookies.set(SEEN_COOKIE, nowSeconds(), seenCookieOptions(secure));
  }
  response.cookies.delete(SSO_COOKIE);
  return response;
}
