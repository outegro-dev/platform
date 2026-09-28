import { refreshSession } from "@outegro/bff/proxy";
import { safeRedirectPath } from "@outegro/bff/safe-redirect";
import { type NextRequest, NextResponse } from "next/server";

const authApiUrl = process.env.AUTH_API_URL ?? "http://localhost:4001";

/**
 * Every page request: keep the session fresh (refresh rotation happens here,
 * before rendering), guard /account, skip /login for signed-in users, and
 * set a nonce-based CSP.
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request, authApiUrl);
  const signedIn =
    session.outcome === "fresh" || session.outcome === "refreshed";
  const { pathname, search } = request.nextUrl;

  if (
    pathname.startsWith("/account") &&
    !signedIn &&
    session.outcome !== "unavailable"
  ) {
    const login = new URL("/login", request.url);
    login.searchParams.set("continue", `${pathname}${search}`);
    return session.apply(NextResponse.redirect(login));
  }
  if (pathname === "/login" && signedIn) {
    const next = safeRedirectPath(
      request.nextUrl.searchParams.get("continue"),
      "/account",
    );
    return session.apply(NextResponse.redirect(new URL(next, request.url)));
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
    // Server actions post back to this origin only; SSO redirects are 3xx, not forms.
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
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
