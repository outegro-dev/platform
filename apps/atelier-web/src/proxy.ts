import { refreshSession, silentSignIn } from "@outegro/bff/proxy";
import { type NextRequest, NextResponse } from "next/server";
import { NONCE_HEADER, PATH_HEADER } from "@/lib/constants";
import { env, mockMode } from "@/lib/env";

/**
 * Every page, route handler and server action: keep the session fresh
 * (refresh rotation happens here, before rendering), sign in silently a
 * visitor already signed in at id.outegro.dev, pass the requested path on
 * for return-after-sign-in, and set a nonce-based CSP. Mock mode has no
 * session to keep. The CV preview frames PDFs from this origin and from the
 * shared CV links.
 */
export async function proxy(request: NextRequest) {
  const session = mockMode
    ? null
    : await refreshSession(request, env.AUTH_API_URL, {
        clientIpSource: env.CLIENT_IP_SOURCE,
        silent: true,
      });
  if (session) {
    const silent = silentSignIn(request, session.outcome, env.APP_URL);
    if (silent) return session.apply(silent);
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  const cvLinks = new URL(env.CV_LINKS_URL).origin;
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    `frame-src 'self' ${cvLinks}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(
    PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return session ? session.apply(response) : response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|health|icon|.*..*).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
