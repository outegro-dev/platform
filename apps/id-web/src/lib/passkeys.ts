import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { z } from "zod";

/**
 * Passkeys (ID-05), shared by the sign-in page and the Security page. The
 * ceremony runs in the browser; everything else goes through server actions
 * to auth-backend, which holds the challenges and verifies the answers.
 * Browser code imports only the types from here (see passkey-name.ts and
 * passkey-ceremony.ts for what runs there).
 */

export type PasskeyItem = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Synced by its provider (iCloud Keychain, Google Password Manager…). */
  synced: boolean;
  backedUp: boolean;
  /** False for a passkey of another relying party: it cannot sign in here. */
  usable: boolean;
};

/** What went wrong, as the messages `passkeys.errors.*` name it. */
export type PasskeyError =
  | "cancelled"
  | "unsupported"
  | "not_allowed"
  | "stale"
  | "rejected"
  | "unknown"
  | "exists"
  | "last_method"
  | "limit"
  | "invalid_name"
  | "suspended"
  | "rate_limited"
  | "unavailable"
  | "offline"
  | "failed";

/** Ceremony outcomes the server actions report besides a message. */
export type PasskeyOutcome =
  | PasskeyError
  | "reauth_required"
  | "signed_out"
  | "not_found";

export type Result<T = object> =
  | ({ ok: true } & T)
  | { ok: false; error: PasskeyOutcome };

/** A loose shape check before anything is forwarded; auth-backend checks it all. */
export const ceremonyResponse = z.looseObject({
  id: z.string().min(1).max(1400),
  rawId: z.string().min(1).max(1400),
  type: z.literal("public-key"),
  response: z.looseObject({ clientDataJSON: z.string().max(4096) }),
});

/** An auth-backend refusal in the words of the UI. */
export function passkeyOutcome(error: unknown): PasskeyOutcome {
  if (error instanceof BackendUnavailable) return "unavailable";
  if (!(error instanceof BackendError)) return "failed";
  const fields = error.error.fieldErrors;
  if (error.status === 401) return "signed_out";
  if (error.status === 404) return "not_found";
  if (error.status === 429) return "rate_limited";
  if (error.status >= 500) return "unavailable";
  if (fields.session?.includes("reauthentication_required"))
    return "reauth_required";
  if (fields.challenge?.includes("stale")) return "stale";
  if (fields.passkey?.includes("unknown")) return "unknown";
  if (fields.passkey?.includes("last_method")) return "last_method";
  if (fields.passkey?.includes("already_registered")) return "exists";
  if (fields.passkey?.includes("limit")) return "limit";
  if (fields.name) return "invalid_name";
  if (error.status === 403) return "suspended";
  if (error.status === 422) return "rejected";
  return "failed";
}
