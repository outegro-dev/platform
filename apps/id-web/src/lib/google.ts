import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { safeRedirectPath } from "@outegro/bff/safe-redirect";

/**
 * Sign-in with Google (ID-02), browser side: authorization code with PKCE
 * and a nonce. The pending request lives in a short HttpOnly cookie; the
 * code itself is exchanged by auth-backend, which holds the client secret.
 */

export const GOOGLE_COOKIE = "og_google";
export const GOOGLE_COOKIE_TTL_SECONDS = 600;

export type GoogleIntent = "login" | "link";
export type GoogleConfig = {
  enabled: boolean;
  clientId: string | null;
  redirectUri: string | null;
};
type Pending = {
  state: string;
  nonce: string;
  verifier: string;
  continueTo: string;
  intent: GoogleIntent;
};

export function startGoogle(
  config: { clientId: string; redirectUri: string },
  intent: GoogleIntent,
  continueTo: string,
) {
  const pending: Pending = {
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(24).toString("base64url"),
    verifier: randomBytes(48).toString("base64url"),
    continueTo,
    intent,
  };
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: createHash("sha256")
      .update(pending.verifier)
      .digest("base64url"),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return {
    url: url.toString(),
    cookie: Buffer.from(JSON.stringify(pending)).toString("base64url"),
  };
}

export function readPending(value: string | undefined): Pending | null {
  if (!value) return null;
  try {
    const data = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      typeof data?.state !== "string" ||
      typeof data?.nonce !== "string" ||
      typeof data?.verifier !== "string" ||
      (data?.intent !== "login" && data?.intent !== "link")
    )
      return null;
    return {
      state: data.state,
      nonce: data.nonce,
      verifier: data.verifier,
      intent: data.intent,
      continueTo: safeRedirectPath(data.continueTo, "/account"),
    };
  } catch {
    return null;
  }
}

export function sameState(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Error keys shown on the login and security pages (messages: googleErrors.*). */
export type GoogleErrorKey =
  | "google_failed"
  | "google_cancelled"
  | "google_unavailable"
  | "google_link_required"
  | "google_unverified"
  | "google_in_use"
  | "google_already_linked"
  | "google_suspended"
  | "google_last_method";

export function googleErrorKey(error: unknown): GoogleErrorKey {
  if (error instanceof BackendUnavailable) return "google_unavailable";
  if (!(error instanceof BackendError)) return "google_failed";
  const fields = error.error.fieldErrors;
  if (fields.email?.includes("link_required")) return "google_link_required";
  if (fields.email?.includes("unverified")) return "google_unverified";
  if (fields.identity?.includes("in_use")) return "google_in_use";
  if (fields.identity?.includes("already_linked"))
    return "google_already_linked";
  if (fields.identity?.includes("last_method")) return "google_last_method";
  if (error.status === 403) return "google_suspended";
  if (error.status === 503 || error.status === 404) return "google_unavailable";
  return "google_failed";
}
