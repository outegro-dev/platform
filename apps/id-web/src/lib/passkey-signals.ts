import { sendSignal } from "@simplewebauthn/browser";
import type { AcceptedPasskeys, UserDetails } from "./passkeys";

/*
 * The browser's side of the WebAuthn Signal API (see passkeys.ts): best
 * effort and silent. Only a browser that has the method is asked, the page
 * never waits for an answer, and a failure changes nothing on the page:
 * the change on the server has already happened.
 */

type SignalMethod = "signalAllAcceptedCredentials" | "signalCurrentUserDetails";

function supports(method: SignalMethod) {
  const api = (
    globalThis as {
      PublicKeyCredential?: Partial<Record<SignalMethod, unknown>>;
    }
  ).PublicKeyCredential;
  return typeof api?.[method] === "function";
}

/**
 * After a removal: asks the server which passkeys the account still
 * accepts (`load`) and tells the device, which can then hide the removed
 * one. Returns at once; a browser without the method does not ask.
 */
export function signalAcceptedPasskeys(
  load: () => Promise<AcceptedPasskeys | null>,
): void {
  if (!supports("signalAllAcceptedCredentials")) return;
  Promise.resolve()
    .then(load)
    .then(
      (accepted) =>
        accepted &&
        sendSignal({
          signalName: "allAcceptedCredentials",
          rpID: accepted.rpId,
          userID: accepted.userId,
          allAcceptedCredentialIDs: accepted.credentialIds,
        }),
    )
    .catch(() => undefined);
}

/** After a new display name: the device shows the account's current names. */
export function signalUserDetails(details: UserDetails | undefined): void {
  if (!details || !supports("signalCurrentUserDetails")) return;
  Promise.resolve()
    .then(() =>
      sendSignal({
        signalName: "currentUserDetails",
        rpID: details.rpId,
        userID: details.userId,
        userName: details.name,
        userDisplayName: details.displayName,
      }),
    )
    .catch(() => undefined);
}
