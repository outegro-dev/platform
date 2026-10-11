import type { SsoClient } from "@outegro/bff/sso";
import { NextResponse } from "next/server";
import { env } from "./env";

/**
 * This site as an SSO client of id.outegro.dev ("landing-web" in
 * auth-backend's OAUTH_CLIENTS), or null while SSO is off: production
 * without APP_URL, ID_URL and AUTH_API_URL. Then nobody is signed in
 * silently, and /api/account and the SSO routes answer 404, as before the
 * site had accounts.
 */
export const sso =
  env.APP_URL && env.ID_URL && env.AUTH_API_URL
    ? {
        /** Public origin of this site: the only place sign-in returns to. */
        appUrl: env.APP_URL,
        authApiUrl: env.AUTH_API_URL,
        client: {
          idUrl: env.ID_URL,
          authApiUrl: env.AUTH_API_URL,
          clientId: "landing-web",
          redirectUri: new URL("/auth/callback", env.APP_URL).toString(),
        } satisfies SsoClient,
      }
    : null;

/** What the SSO routes and /api/account answer while SSO is off. */
export function ssoOff() {
  return new NextResponse(null, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Same-origin check for state-changing requests that are not server actions. */
export function fromThisApp(request: Request, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return (
    origin === new URL(appUrl).origin || origin === new URL(request.url).origin
  );
}
