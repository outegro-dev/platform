import type { SsoClient } from "@outegro/bff/sso";
import { env } from "./env";

/** This app as an SSO client of id.outegro.dev (registered in auth-backend). */
export const ssoClient: SsoClient = {
  idUrl: env.ID_URL,
  authApiUrl: env.AUTH_API_URL,
  clientId: "pay-web",
  redirectUri: new URL("/auth/callback", env.APP_URL).toString(),
};

/** An absolute URL on this app's public origin. */
export function appUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

/** Where sign-in starts, coming back to `path` afterwards. */
export function signInPath(path: string) {
  return `/auth/sign-in?returnTo=${encodeURIComponent(path)}`;
}
