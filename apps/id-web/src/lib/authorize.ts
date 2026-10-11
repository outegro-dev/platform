import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import type { PlatformUrls } from "@outegro/ui/lib/platform";
import { z } from "zod";

const requestSchema = z.object({
  response_type: z.literal("code").optional(),
  client_id: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
  redirect_uri: z.url().max(500),
  state: z.string().min(16).max(256),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal("S256"),
  // Only `none` changes anything; other OIDC prompts are ignored like any
  // unknown parameter, not read as a broken link.
  prompt: z.string().optional(),
});

export type AuthorizeRequest = z.infer<typeof requestSchema> & {
  /** `prompt=none`: an app's silent sign-in, no page is shown. */
  silent: boolean;
};

/** An app's /authorize request from the query, or null for a broken link. */
export function parseAuthorizeRequest(
  query: Record<string, string | string[] | undefined>,
): AuthorizeRequest | null {
  const parsed = requestSchema.safeParse(
    Object.fromEntries(
      Object.entries(query).filter(([, value]) => typeof value === "string"),
    ),
  );
  if (!parsed.success) return null;
  return { ...parsed.data, silent: parsed.data.prompt === "none" };
}

/**
 * What /authorize does when the client registry refused the request or
 * could not be asked:
 * - `invalid`: the registry refused the client or its redirect URI. The
 *   page says the link is not valid and redirects nowhere, silent or not.
 * - `answer`: an outage, for a silent request to the exact callback of a
 *   platform app: the app gets `temporarily_unavailable`, so the visitor
 *   is not stranded on a page they never asked for.
 * - `outage`: any other outage; the error page offers a retry.
 */
export function registryFailure(
  error: unknown,
  request: Pick<AuthorizeRequest, "silent" | "redirect_uri">,
  urls: PlatformUrls,
): "invalid" | "answer" | "outage" {
  if (!(error instanceof BackendUnavailable)) return "invalid";
  return request.silent && isPlatformCallback(request.redirect_uri, urls)
    ? "answer"
    : "outage";
}

/** What a silent request (`prompt=none`) gets instead of a page: OIDC error codes. */
export type SilentError =
  | "login_required"
  | "invalid_request"
  | "temporarily_unavailable";

/** The answer to a silent request at the app's callback, with its state. */
export function silentAnswer(
  redirectUri: string,
  state: string,
  error: SilentError,
) {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  target.searchParams.set("state", state);
  return target.toString();
}

/** Why no code was issued: no session here, a refused request, an outage. */
export function silentError(error: unknown): SilentError {
  if (error instanceof BackendError) {
    if (error.status === 401) return "login_required";
    if (error.status < 500) return "invalid_request";
  }
  return "temporarily_unavailable";
}

/**
 * Whether a redirect URI is the SSO callback of one of the platform's apps
 * or of the portfolio site, as this frontend is configured: the only place
 * a silent request is answered while the client registry cannot be asked.
 */
export function isPlatformCallback(redirectUri: string, urls: PlatformUrls) {
  return [urls.site, urls.pay, urls.battleship, urls.edu, urls.admin].some(
    (origin) => new URL("/auth/callback", origin).toString() === redirectUri,
  );
}
