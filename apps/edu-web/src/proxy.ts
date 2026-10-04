import { refreshSession } from "@outegro/bff/proxy";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Every page and server action: keep the session fresh (refresh rotation
 * happens here, before rendering) and set a nonce-based CSP that also
 * admits the SQL sandbox's Web Worker. No page needs sign-in before it
 * renders: a chapter that needs an account shows its own sign-in gate.
 */
export async function proxy(request: NextRequest) {
  const session = await refreshSession(request, env.AUTH_API_URL, {
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // The SQL sandbox runs SQLite (sql.js, asm build) in a dedicated worker
    // from this origin; the bundler may start it from a blob: bootstrap.
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Server actions (sign-out among them) post back to this origin only;
    // SSO redirects are navigations, not form posts.
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
