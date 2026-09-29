import {
  browserSupportsWebAuthn,
  WebAuthnError,
} from "@simplewebauthn/browser";
import type { PasskeyError } from "./passkeys";

/**
 * Why the browser's side of a ceremony failed, for the user. Browsers use
 * one NotAllowedError for "cancelled", "timed out" and "no passkey here" on
 * purpose (it hides which passkeys exist), so they read as one message.
 * `aborted` is our own doing (a newer ceremony replaced this one): silent.
 */
export function ceremonyError(error: unknown): PasskeyError | "aborted" {
  if (!browserSupportsWebAuthn()) return "unsupported";
  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case "ERROR_CEREMONY_ABORTED":
        return "aborted";
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return "exists";
      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        return "not_allowed";
      case "ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT":
      case "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT":
      case "ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG":
      case "ERROR_MALFORMED_PUBKEYCREDPARAMS":
        return "unsupported";
      case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
        return nameOf(error.cause) === "NotAllowedError"
          ? "cancelled"
          : "failed";
      default:
        return "failed";
    }
  }
  switch (nameOf(error)) {
    case "AbortError":
      return "aborted";
    case "NotAllowedError":
      return "cancelled";
    // Blocked by Permissions-Policy, an insecure context or a foreign frame.
    case "SecurityError":
      return "not_allowed";
    case "NotSupportedError":
      return "unsupported";
    default:
      return "failed";
  }
}

const nameOf = (error: unknown) =>
  error instanceof Error ? error.name : undefined;
