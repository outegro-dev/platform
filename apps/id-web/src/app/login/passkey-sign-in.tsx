"use client";

import { Button } from "@outegro/ui/button";
import { FormMessage } from "@outegro/ui/form-message";
import { FingerprintIcon, WifiSlashIcon } from "@phosphor-icons/react";
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  sendSignal,
  startAuthentication,
  WebAuthnAbortService,
} from "@simplewebauthn/browser";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";
import { isOffline } from "@/lib/online";
import { ceremonyError } from "@/lib/passkey-ceremony";
import type { PasskeyError, PasskeyOutcome } from "@/lib/passkeys";
import { passkeySignIn, passkeySignInOptions } from "./passkey-actions";

/**
 * Autofill waits for the user as long as the page is open, but a challenge
 * lives five minutes in auth-backend: a fresh one is taken before that.
 */
const REARM_MS = 4 * 60_000;

/** Sign-in outcomes that have a message of their own. */
const shown = (outcome: PasskeyOutcome): PasskeyError =>
  outcome === "reauth_required" ||
  outcome === "signed_out" ||
  outcome === "not_found"
    ? "failed"
    : outcome;

/**
 * Hands the browser's answer to the server. Signed in, the action
 * redirects and nothing comes back; otherwise the problem does.
 */
async function finish(
  begun: { challengeId: string; rpId?: string },
  answer: { id: string },
  continueTo: string,
): Promise<PasskeyError | null> {
  const result = await passkeySignIn(begun.challengeId, answer, continueTo);
  if (!result || result.ok) return null;
  // A passkey the account no longer has: let the device forget it too.
  if (result.error === "unknown" && begun.rpId)
    sendSignal({
      signalName: "unknownCredential",
      rpID: begun.rpId,
      credentialID: answer.id,
    }).catch(() => undefined);
  return shown(result.error);
}

/**
 * "Sign in with a passkey" (ID-05) on the sign-in page, and the same
 * passkeys in the email field's autofill where the browser offers it
 * (conditional mediation). Usernameless: the passkey names the account.
 */
export function PasskeySignIn({ continueTo }: { continueTo: string }) {
  const t = useTranslations("passkeys");
  const [error, setError] = useState<PasskeyError | null>(null);
  const [pending, startTransition] = useTransition();
  // Bumped to arm autofill again: after our own ceremony, and on a timer.
  const [armed, setArmed] = useState(0);
  const modal = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `armed` is the trigger; each value is one autofill request.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = async () => {
      if (!(await browserSupportsWebAuthnAutofill()) || !active) return;
      const begun = await passkeySignInOptions();
      // Quietly: the button still works, and says what is wrong.
      if (!begun.ok || !active || modal.current) return;
      timer = setTimeout(() => {
        if (!modal.current) setArmed((n) => n + 1);
      }, REARM_MS);
      let answer: Awaited<ReturnType<typeof startAuthentication>>;
      try {
        answer = await startAuthentication({
          optionsJSON: begun.options,
          useBrowserAutofill: true,
          // The email field comes and goes with the steps of the form; the
          // browser offers passkeys whenever it is there.
          verifyBrowserAutofillInput: false,
        });
      } catch (reason) {
        // Replaced by the button or by a fresh challenge, or dismissed.
        if (active && ceremonyError(reason) === "failed") setError("failed");
        return;
      } finally {
        clearTimeout(timer);
      }
      setError(null);
      const problem = await finish(
        { challengeId: begun.challengeId, rpId: begun.options.rpId },
        answer,
        continueTo,
      );
      if (!active) return;
      setError(problem);
      setArmed((n) => n + 1);
    };
    void arm();
    return () => {
      active = false;
      clearTimeout(timer);
      if (!modal.current) WebAuthnAbortService.cancelCeremony();
    };
  }, [armed, continueTo]);

  const signIn = () => {
    if (isOffline()) return setError("offline");
    if (!browserSupportsWebAuthn()) return setError("unsupported");
    setError(null);
    startTransition(async () => {
      modal.current = true;
      try {
        const begun = await passkeySignInOptions();
        if (!begun.ok) return setError(shown(begun.error));
        let answer: Awaited<ReturnType<typeof startAuthentication>>;
        try {
          answer = await startAuthentication({ optionsJSON: begun.options });
        } catch (reason) {
          const key = ceremonyError(reason);
          if (key !== "aborted") setError(key);
          return;
        }
        setError(
          await finish(
            { challengeId: begun.challengeId, rpId: begun.options.rpId },
            answer,
            continueTo,
          ),
        );
      } finally {
        modal.current = false;
        setArmed((n) => n + 1);
      }
    });
  };

  return (
    <div className="passkey-sign-in">
      <Button
        type="button"
        variant="outline"
        pending={pending}
        pendingLabel={t("signingIn")}
        onClick={signIn}
      >
        <FingerprintIcon aria-hidden="true" />
        {t("signIn")}
      </Button>
      <FormMessage
        role="status"
        lines={2}
        tone={error ? "error" : "neutral"}
        icon={error === "offline" ? <WifiSlashIcon weight="bold" /> : undefined}
      >
        {error ? t(`errors.${error}`) : t("signInHint")}
      </FormMessage>
    </div>
  );
}
