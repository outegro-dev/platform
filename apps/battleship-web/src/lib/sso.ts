import type { SsoClient } from "@outegro/bff/sso";
import { env } from "./env";

/** This app as an SSO client of id.outegro.dev (registered in auth-backend). */
export const ssoClient: SsoClient = {
  idUrl: env.ID_URL,
  authApiUrl: env.AUTH_API_URL,
  clientId: "battleship-web",
  redirectUri: new URL("/auth/callback", env.APP_URL).toString(),
};

/** An absolute URL on this app's public origin. */
export function appUrl(path: string): URL {
  return new URL(path, env.APP_URL);
}

/** Same-origin check for state-changing requests that are not server actions. */
export function fromThisApp(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return (
    origin === new URL(env.APP_URL).origin ||
    origin === new URL(request.url).origin
  );
}
