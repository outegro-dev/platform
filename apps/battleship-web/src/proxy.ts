import { refreshSession } from "@outegro/bff/proxy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { requiresSignIn } from "@/lib/routes";

/**
 * Every page and API request: keep the session fresh (refresh rotation
 * happens here, before rendering), send signed-out visitors of game pages to
 * sign-in, and set a nonce-based CSP that also admits the game WebSocket.
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request, env.AUTH_API_URL, {
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
  const signedIn =
    session.outcome === "fresh" || session.outcome === "refreshed";
  const { pathname, search } = request.nextUrl;

  if (
    requiresSignIn(pathname) &&
    !signedIn &&
    session.outcome !== "unavailable"
  ) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("returnTo", `${pathname}${search}`);
    return session.apply(NextResponse.redirect(signIn));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  const gameSocket = new URL(env.GAME_WS_URL).origin;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${gameSocket}${dev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Server actions and the sign-out form post back to this origin only;
    // SSO and checkout redirects are navigations, not form posts.
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
