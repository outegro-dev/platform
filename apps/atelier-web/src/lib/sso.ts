import type { SsoClient } from "@outegro/bff/sso";
import { env } from "./env";

/** This app as an SSO client of id.outegro.dev (registered in auth-backend). */
export const ssoClient: SsoClient = {
  idUrl: env.ID_URL,
  authApiUrl: env.AUTH_API_URL,
  clientId: "atelier-web",
  redirectUri: new URL("/auth/callback", env.APP_URL).toString(),
};

/** An absolute URL on this app's public origin. */
export function appUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

/**
 * State-changing requests (sign-out, the BFF's writes) must come from this
 * app's own pages: Sec-Fetch-Site same-origin, or (an older browser) the
 * same Origin.
 */
export function fromThisApp(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return request.headers.get("origin") === new URL(env.APP_URL).origin;
}
