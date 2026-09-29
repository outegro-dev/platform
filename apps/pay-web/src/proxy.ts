import { refreshSession } from "@outegro/bff/proxy";
import { RETURN_PARAM } from "@outegro/ui/lib/platform";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  RETURN_COOKIE,
  RETURN_MAX_AGE_SECONDS,
  returnTarget,
} from "@/lib/return-to";
import { isApiPath, isPublicPath } from "@/lib/routes";
import { appUrl, signInPath } from "@/lib/sso";

/**
 * Every page and API request: keep the session fresh (refresh rotation
 * happens here, before rendering), send signed-out visitors to SSO sign-in
 * (JSON 401 for API calls), remember an allowed way back to the app the
 * buyer came from, and set a nonce-based CSP.
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request, env.AUTH_API_URL, {
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
  const signedIn =
    session.outcome === "fresh" || session.outcome === "refreshed";
  const { pathname, search } = request.nextUrl;

  // Identity unreachable: let the page render; its own calls decide.
  // Server actions answer "signed out" themselves instead of a redirect.
  if (
    !signedIn &&
    session.outcome !== "unavailable" &&
    !isPublicPath(pathname) &&
    !request.headers.has("next-action")
  ) {
    if (isApiPath(pathname)) {
      return session.apply(
        NextResponse.json(
          { status: "signed-out" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        ),
      );
    }
    return session.apply(
      NextResponse.redirect(appUrl(signInPath(`${pathname}${search}`))),
    );
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Server actions post back to this origin only; SSO and checkout
    // redirects are navigations, not form posts.
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  // An app sent the buyer here with ?return=…: remember the way back, but
  // only to a platform app's origin; anything else is ignored.
  const back = returnTarget(request.nextUrl.searchParams.get(RETURN_PARAM));
  if (back) request.cookies.set(RETURN_COOKIE, back.href);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  if (back) {
    response.cookies.set(RETURN_COOKIE, back.href, {
      httpOnly: true,
      secure: https,
      sameSite: "lax",
      path: "/",
      maxAge: RETURN_MAX_AGE_SECONDS,
    });
  }
  return session.apply(response);
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|health|icon|.*\\..*).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
