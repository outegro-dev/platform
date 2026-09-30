import { BackendError, BackendUnavailable } from "@outegro/bff/backend";
import { z } from "zod";
import { env } from "./env";

/**
 * Passkeys (ID-05), shared by the sign-in page and the Security page. The
 * ceremony runs in the browser; everything else goes through server actions
 * to auth-backend, which holds the challenges and verifies the answers.
 * Browser code imports only the types from here (see passkey-name.ts,
 * passkey-ceremony.ts and passkey-signals.ts for what runs there).
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
  /**
   * The WebAuthn credential id (base64url), which the device knows the
   * passkey by. auth-backend does not send it yet; without it the device
   * hears about removals only once no passkey is left (see
   * `acceptedPasskeysSignal`).
   */
  credentialId?: string;
};

/*
 * The WebAuthn Signal API tells the device about changes made here, so its
 * passkey list matches the account: which passkeys the account still
 * accepts (after a removal) and the account's current name (after a new
 * display name). The server prepares what to say; passkey-signals.ts says
 * it where the browser can. A passkey's own name lives only here: no
 * signal carries it, so a rename tells the device nothing.
 */

/** After a removal: every passkey of this RP the account accepts. */
export type AcceptedPasskeys = {
  rpId: string;
  userId: string;
  credentialIds: string[];
};

/** After a new display name: what the device shows for the account. */
export type UserDetails = {
  rpId: string;
  userId: string;
  name: string;
  displayName: string;
};

/**
 * The RP ID passkeys are created for: the host of id.outegro.dev, the only
 * origin of the ceremonies (auth-backend WEBAUTHN_RP_ID; localhost locally).
 */
export function passkeyRpId() {
  return new URL(env.ID_URL).hostname;
}

/** The WebAuthn user handle of an account: the 16 bytes of its UUID, base64url. */
export function userHandle(userId: string) {
  return Buffer.from(userId.replaceAll("-", ""), "hex").toString("base64url");
}

/**
 * The passkeys to name after a removal, or null when the list cannot be
 * given in full: a device hides every passkey of the account that is not
 * named, so one missing credential id would hide a passkey that still
 * works. Passkeys of another RP are not this RP's to list.
 */
export function acceptedPasskeysSignal(
  userId: string,
  items: PasskeyItem[],
): AcceptedPasskeys | null {
  const credentialIds: string[] = [];
  for (const item of items) {
    if (!item.usable) continue;
    if (!item.credentialId) return null;
    credentialIds.push(item.credentialId);
  }
  return { rpId: passkeyRpId(), userId: userHandle(userId), credentialIds };
}

/**
 * The account as its passkeys show it: the email as the name and the
 * display name, or the email without one (as auth-backend registers them).
 */
export function userDetailsSignal(profile: {
  id: string;
  email: string;
  displayName: string | null;
}): UserDetails {
  return {
    rpId: passkeyRpId(),
    userId: userHandle(profile.id),
    name: profile.email,
    displayName: profile.displayName ?? profile.email,
  };
}

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
