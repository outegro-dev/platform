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
};

export type SignInFailure =
  | "state_mismatch"
  | "missing_code"
  | "invalid_grant"
  | "unavailable";

export type SignInResult =
  | { ok: true; tokens: SessionTokens; returnTo: string }
  | { ok: false; reason: SignInFailure };

/** The /authorize URL to send the browser to, and the cookie to set meanwhile. */
export function beginSignIn(client: SsoClient, returnTo?: string | null) {
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
  }).toString();
  const pending: PendingSignIn = {
    state,
    verifier,
    returnTo: safeRedirectPath(returnTo),
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
    return { ok: false, reason: "state_mismatch" };
  const code = params.get("code");
  if (!code) return { ok: false, reason: "missing_code" };
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
    return { ok: true, tokens, returnTo: pending.returnTo };
  } catch (error) {
    if (error instanceof BackendUnavailable)
      return { ok: false, reason: "unavailable" };
    if (error instanceof BackendError)
      return { ok: false, reason: "invalid_grant" };
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
