import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BackendError, BackendUnavailable, createBackend } from "./backend";
import { safeRedirectPath } from "./safe-redirect";
import type { SessionTokens } from "./session";

/**
 * Sign-in of a platform app through id.outegro.dev (ID-04): authorization
 * code with PKCE. The app's BFF remembers one pending sign-in in a short-lived
 * HttpOnly cookie, sends the browser to /authorize, and on the callback swaps
 * the code for the app's own session, server to server.
 */

/** Cookie with the pending sign-in: state, PKCE verifier, return path. */
export const SSO_COOKIE = "og_sso";
const PENDING_TTL_SECONDS = 600;

export type SsoClient = {
  /** Public origin of the identity frontend, e.g. https://id.outegro.dev. */
  idUrl: string;
  /** Internal base URL of auth-backend. */
  authApiUrl: string;
  clientId: string;
  /** Absolute callback URL registered for the client in auth-backend. */
  redirectUri: string;
};

export type PendingSignIn = {
  state: string;
  verifier: string;
  returnTo: string;
  /** Asked with `prompt=none`: the visitor did not ask to sign in. */
  silent: boolean;
};

export type SignInFailure =
  | "state_mismatch"
  | "missing_code"
  | "invalid_grant"
  | "unavailable"
  | "login_required";

/**
 * A failed silent sign-in carries its return path: the visitor never asked
 * to sign in, so they land there signed out instead of on an error page.
 */
export type SignInResult =
  | { ok: true; tokens: SessionTokens; returnTo: string; silent: boolean }
  | { ok: false; reason: SignInFailure; silent: false }
  | { ok: false; reason: SignInFailure; silent: true; returnTo: string };

/**
 * The /authorize URL to send the browser to, and the cookie to set
 * meanwhile. `silent` asks Identity not to show its sign-in page
 * (`prompt=none`): with its session it issues the code as usual, without
 * one it answers `error=login_required`.
 */
export function beginSignIn(
  client: SsoClient,
  returnTo?: string | null,
  { silent = false }: { silent?: boolean } = {},
) {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("/authorize", client.idUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(silent ? { prompt: "none" } : {}),
  }).toString();
  const pending: PendingSignIn = {
    state,
    verifier,
    returnTo: safeRedirectPath(returnTo),
    silent,
  };
  return { url: url.toString(), cookie: encodePending(pending) };
}

export function pendingCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: PENDING_TTL_SECONDS,
  };
}

/**
 * Finishes the callback: the state must match the pending sign-in, then the
 * code is exchanged once. The caller writes the session and always deletes
 * SSO_COOKIE, whatever the result.
 */
export async function completeSignIn(
  client: SsoClient,
  params: URLSearchParams,
  pendingCookie: string | undefined,
  headers: Record<string, string> = {},
): Promise<SignInResult> {
  const pending = decodePending(pendingCookie);
  const state = params.get("state");
  if (!pending || !state || !sameString(state, pending.state))
    return { ok: false, reason: "state_mismatch", silent: false };
  const fail = (reason: SignInFailure): SignInResult =>
    pending.silent
      ? { ok: false, reason, silent: true, returnTo: pending.returnTo }
      : { ok: false, reason, silent: false };
  const code = params.get("code");
  if (!code) {
    const error = params.get("error");
    if (error === "login_required") return fail("login_required");
    return fail(
      error === "temporarily_unavailable" ? "unavailable" : "missing_code",
    );
  }
  try {
    const tokens = await createBackend(client.authApiUrl, {
      headers: () => headers,
    })<SessionTokens>("/v1/oauth/token", {
      method: "POST",
      body: {
        grantType: "authorization_code",
        clientId: client.clientId,
        redirectUri: client.redirectUri,
        code,
        codeVerifier: pending.verifier,
      },
    });
    return {
      ok: true,
      tokens,
      returnTo: pending.returnTo,
      silent: pending.silent,
    };
  } catch (error) {
    if (error instanceof BackendUnavailable) return fail("unavailable");
    if (error instanceof BackendError) return fail("invalid_grant");
    throw error;
  }
}

/** Ends the app's session in Identity. Cookies are cleared by the caller either way. */
export async function endSession(
  authApiUrl: string,
  refreshToken: string | undefined,
  headers: Record<string, string> = {},
) {
  if (!refreshToken) return;
  try {
    await createBackend(authApiUrl, { headers: () => headers })(
      "/v1/sessions/logout",
      { method: "POST", body: { refreshToken } },
    );
  } catch {
    // The session expires on its own; signing out locally must still work.
  }
}

export function decodePending(
  value: string | undefined | null,
): PendingSignIn | null {
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof data?.state === "string" &&
      typeof data?.verifier === "string" &&
      typeof data?.returnTo === "string"
    ) {
      return {
        state: data.state,
        verifier: data.verifier,
        returnTo: safeRedirectPath(data.returnTo),
        silent: data.silent === true,
      };
    }
  } catch {
    // Tampered or truncated cookie: treated as no pending sign-in.
  }
  return null;
}

function encodePending(pending: PendingSignIn) {
  return Buffer.from(JSON.stringify(pending)).toString("base64url");
}

function sameString(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
