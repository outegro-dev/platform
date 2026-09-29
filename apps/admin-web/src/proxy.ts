import { clientHeaders } from "@outegro/bff/client";
import { refreshSession } from "@outegro/bff/proxy";
import {
  clearSession,
  isSecureRequest,
  REFRESH_COOKIE,
} from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import { type NextRequest, NextResponse } from "next/server";
import { PATH_HEADER } from "@/lib/constants";
import { env } from "@/lib/env";
import { isIdle, nowSeconds, SEEN_COOKIE, seenCookieOptions } from "@/lib/idle";
import { GRAFANA_AUTH_PATH } from "@/lib/monitoring";

/** Reachable without a session: sign-in, the SSO round trip, sign-out. */
const isPublic = (pathname: string) =>
  pathname === "/sign-in" || pathname.startsWith("/auth/");

/**
 * Every request: keep the session fresh (refresh rotation happens here,
 * before rendering), end sessions idle for too long, send signed-out
 * visitors to sign-in, and set a nonce-based CSP. Pages still check the
 * operator's permissions, and every service checks them again.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Traefik's ForwardAuth for Grafana only reads the session: its answers
  // never carry cookies to the browser, so a refresh here would rotate the
  // refresh token and lose the new one. It sends the browser to
  // /monitoring for that instead.
  if (pathname === GRAFANA_AUTH_PATH) return NextResponse.next();
  const open = isPublic(pathname);
  const api = pathname.startsWith("/api/");
  const session = await refreshSession(request, env.AUTH_API_URL, {
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
  const signedIn =
    session.outcome === "fresh" || session.outcome === "refreshed";
  const secure = isSecureRequest(request.headers, request.url);

  if (!open && signedIn && isIdle(request.cookies.get(SEEN_COOKIE)?.value)) {
    // Idle past the limit: end the session in Identity too, not just here.
    await endSession(
      env.AUTH_API_URL,
      request.cookies.get(REFRESH_COOKIE)?.value,
      clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
    );
    const response = api
      ? NextResponse.json({ error: "session_idle" }, { status: 401 })
      : NextResponse.redirect(new URL("/sign-in?reason=idle", request.url));
    clearSession(response.cookies);
    response.cookies.delete(SEEN_COOKIE);
    return response;
  }

  if (!open && !signedIn && session.outcome !== "unavailable") {
    if (api) {
      return session.apply(
        NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
      );
    }
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("returnTo", `${pathname}${search}`);
    return session.apply(NextResponse.redirect(signIn));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Server actions and the sign-out form post back to this origin only;
    // the SSO hop to id.outegro.dev is a link, not a form.
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(secure ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  headers.set(PATH_HEADER, `${pathname}${search}`);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  if (!open && signedIn) {
    response.cookies.set(SEEN_COOKIE, nowSeconds(), seenCookieOptions(secure));
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
