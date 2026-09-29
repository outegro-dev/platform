import { env } from "./env";

/** SSO client registration of this console in Identity (ID-04). */
export const ssoClient = {
  idUrl: env.ID_URL,
  authApiUrl: env.AUTH_API_URL,
  clientId: "admin-web",
  redirectUri: `${env.APP_URL}/auth/callback`,
};

/** An absolute URL on this console's public origin. */
export function appUrl(path: string): URL {
  return new URL(path, `${env.APP_URL}/`);
}

/** The sign-in entry (SSO through id.outegro.dev), returning to `returnTo`. */
export function signInPath(returnTo: string): string {
  return `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * State-changing requests (sign-out, keepalive) must come from this
 * console's own pages: same Origin, or Sec-Fetch-Site same-origin.
 */
export function fromThisApp(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(env.APP_URL).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export type Environment = "production" | "local" | "preview";

/** Where the console runs, for the environment badge. */
export function environmentOf(url: string): Environment {
  const host = new URL(url).hostname;
  if (host === "admin.outegro.dev") return "production";
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  )
    return "local";
  return "preview";
}
