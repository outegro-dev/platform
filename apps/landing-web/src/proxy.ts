import { silentSignIn } from "@outegro/bff/proxy";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@outegro/bff/session";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sso } from "@/lib/sso";

/**
 * Every page: sign in silently a visitor already signed in at
 * id.outegro.dev (unless SSO is off), and set a strict CSP. Pages never
 * read the session (the header asks /api/account, which also refreshes
 * it), so the proxy calls no service and the HTML is the same for
 * everyone; only a browser without any session here can be sent to sign in.
 */
export function proxy(request: NextRequest) {
  const sessionless =
    !request.cookies.has(ACCESS_COOKIE) && !request.cookies.has(REFRESH_COOKIE);
  const silent =
    sso && sessionless ? silentSignIn(request, "anonymous", sso.appUrl) : null;
  if (silent) return silent;
  // Strict CSP: scripts only with this request's nonce (Next.js applies it to its own tags).
  // Inline style attributes are unavoidable with React/Radix, so styles allow 'unsafe-inline'.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  // Only upgrade when served over TLS (Traefik sets x-forwarded-proto);
  // on plain-http localhost Safari would rewrite every asset to https.
  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.nextUrl.protocol === "https:";
  // Google hosts only once GTM_ID is set. The nonced bootstrap loads GTM and
  // 'strict-dynamic' trusts what it injects; the script host is for browsers
  // without 'strict-dynamic', the rest is where GA4 sends its hits.
  const gtmScript = env.GTM_ID ? " https://www.googletagmanager.com" : "";
  const gtmHits = env.GTM_ID
    ? " https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com"
    : "";
  // Nothing unless listed: the pages embed no frames, media or manifest and
  // start no workers.
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${gtmScript}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${gtmHits}`,
    "font-src 'self'",
    `connect-src 'self'${gtmHits}${dev ? " ws: wss:" : ""}`,
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Every page, but not build assets, probes, generated images or
      // files. The dot is escaped: a bare "." matched any path but "/".
      source:
        "/((?!_next/static|_next/image|health|og|icon|apple-icon|.*\\..*).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
