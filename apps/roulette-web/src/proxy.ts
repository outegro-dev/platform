import { refreshSession, silentSignIn } from "@outegro/bff/proxy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Every page and API request: keep the session fresh (refresh rotation
 * happens here, before rendering), sign in silently a visitor already
 * signed in at id.outegro.dev, and set a nonce-based CSP that also admits
 * the game WebSocket. No page demands sign-in: a signed-out visitor sees
 * the results and a "Sign in" button.
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request, env.AUTH_API_URL, {
    clientIpSource: env.CLIENT_IP_SOURCE,
    silent: true,
  });
  const silent = silentSignIn(request, session.outcome, env.APP_URL);
  if (silent) return session.apply(silent);

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
    "object-src 'none'",
    "base-uri 'self'",
    // The sign-out form posts back to this origin only; SSO redirects are
    // navigations, not form posts.
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
