"use client";

import { FormMessage } from "@outegro/ui/form-message";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { cn } from "@outegro/ui/lib/utils";
import {
  ArrowClockwiseIcon,
  ArrowRightIcon,
  ArrowUUpLeftIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import {
  type FormEvent,
  useActionState,
  useEffect,
  useRef,
  useState,
} from "react";
import { SubmitButton } from "@/components/submit-button";
import { isOffline, useOnline } from "@/lib/online";
import { type LoginState, loginAction } from "./actions";

const CODE_LENGTH = 6;
/** Digits only, so a pasted "123 456" or "123-456" still fits. */
const toCode = (value: string) =>
  value.replace(/\D/g, "").slice(0, CODE_LENGTH);

/** Counts a server-measured duration down on the browser clock; restarts per challenge. */
function useCountdown(
  seconds: number | undefined,
  challengeId: string | undefined,
) {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds || !challengeId) {
      setLeft(0);
      return;
    }
    const deadline = Date.now() + seconds * 1000;
    setLeft(seconds);
    const id = setInterval(() => {
      const rest = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setLeft(rest);
      if (rest === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, challengeId]);
  return left;
}

/** Problems caught in the browser, before anything is sent. */
type ClientError = "offline" | "invalid_email" | "incomplete_code";

const FIELD_ERRORS = new Set([
  "invalid_email",
  "invalid_code",
  "incomplete_code",
]);

export function LoginForm({
  continueTo,
  defaultEmail = "",
}: {
  continueTo: string;
  /** The signed-in account's address when it is asked to sign in again. */
  defaultEmail?: string;
}) {
  const t = useTranslations("login");
  const [state, action, busy] = useActionState<LoginState, FormData>(
    loginAction,
    { step: "email" },
  );
  const online = useOnline();
  // Controlled, so React's form reset after each action keeps what was typed.
  const [email, setEmail] = useState(state.email ?? defaultEmail);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const [backToEmail, setBackToEmail] = useState(false);
  // A browser-side error belongs to the server state it was raised on: the
  // next answer from the server replaces it.
  const [clientError, setClientError] = useState<{
    error: ClientError;
    on: LoginState;
  } | null>(null);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.email) setEmail(state.email);
    if (state.challengeId !== seen.challengeId) {
      setCode("");
      setResent(seen.step === "code" && state.step === "code");
    }
    setBackToEmail(seen.step === "code" && state.step === "email");
  }

  const wait = useCountdown(
    state.step === "code" ? state.resendIn : undefined,
    state.challengeId,
  );
  const local =
    clientError?.on === state && !(clientError.error === "offline" && online)
      ? clientError.error
      : undefined;
  const error = local ?? state.error;
  const errorText = error
    ? t(`errors.${error}` as "errors.invalid_code")
    : null;
  // Only a wrong value marks the field; offline or rate limits are not its fault.
  const invalid = error ? FIELD_ERRORS.has(error) : false;

  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  // After a failed attempt the cursor goes back where the fix is needed.
  useEffect(() => {
    if (!state.error) return;
    const input = state.step === "code" ? codeRef.current : emailRef.current;
    input?.focus();
    if (state.step === "code") input?.select();
  }, [state]);
  useEffect(() => {
    if (backToEmail) emailRef.current?.select();
  }, [backToEmail]);

  const guard =
    (check?: () => ClientError | undefined) =>
    (event: FormEvent<HTMLFormElement>) => {
      const problem = isOffline() ? "offline" : check?.();
      if (!problem) return;
      event.preventDefault();
      setClientError({ error: problem, on: state });
      if (problem === "invalid_email") emailRef.current?.focus();
      if (problem === "incomplete_code") codeRef.current?.focus();
    };

  const message = (id: string, hint: string) => (
    <FormMessage
      id={id}
      lines={2}
      tone={errorText ? "error" : "neutral"}
      icon={error === "offline" ? <WifiSlashIcon weight="bold" /> : undefined}
      aria-live="polite"
    >
      {errorText ?? hint}
    </FormMessage>
  );

  const sent =
    state.step !== "code"
      ? ""
      : state.delivery === "failed"
        ? t("deliveryFailed")
        : t(resent ? "codeResentTo" : "codeSentTo", {
            email: state.email ?? "",
          });

  return (
    <div className="login-flow" aria-busy={busy || undefined}>
      {/* One live region for both steps, so the step change is announced. */}
      <p
        className={cn("login-sent", state.step === "email" && "sr-only")}
        data-tone={state.delivery === "failed" ? "warning" : undefined}
        aria-live="polite"
      >
        {sent}
      </p>
      {state.step === "email" ? (
        <form
          action={action}
          onSubmit={guard(() =>
            emailRef.current?.validity.valid === false
              ? "invalid_email"
              : undefined,
          )}
          className="login-form"
          noValidate
        >
          <input type="hidden" name="intent" value="request" />
          <div className="field">
            <Label htmlFor="email">{t("email")}</Label>
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              // "webauthn": the browser offers passkeys here too (autofill).
              autoComplete="email webauthn"
              enterKeyHint="go"
              spellCheck={false}
              placeholder={t("emailPlaceholder")}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
              aria-invalid={invalid || undefined}
              aria-describedby="email-message"
            />
            {message("email-message", t("emailHint"))}
          </div>
          <SubmitButton size="lg" pendingLabel={t("sending")}>
            {t("sendCode")}
            <ArrowRightIcon />
          </SubmitButton>
        </form>
      ) : (
        <>
          <form
            action={action}
            onSubmit={guard(() =>
              code.length === CODE_LENGTH ? undefined : "incomplete_code",
            )}
            className="login-form"
            noValidate
          >
            <input type="hidden" name="intent" value="verify" />
            <input type="hidden" name="continue" value={continueTo} />
            <div className="field">
              <Label htmlFor="code">{t("code")}</Label>
              <Input
                ref={codeRef}
                id="code"
                name="code"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                pattern="\d{6}"
                value={code}
                onChange={(event) => setCode(toCode(event.target.value))}
                required
                autoFocus
                aria-invalid={invalid || undefined}
                aria-describedby="code-message"
              />
              {message("code-message", t("codeHint"))}
            </div>
            <SubmitButton
              size="lg"
              pendingLabel={t("verifying")}
              disabled={busy}
            >
              {t("verify")}
              <ArrowRightIcon />
            </SubmitButton>
          </form>
          <div className="login-secondary">
            <form action={action} onSubmit={guard()}>
              <input type="hidden" name="intent" value="request" />
              <input type="hidden" name="email" value={state.email ?? ""} />
              <SubmitButton
                variant="link"
                className="tabular-nums"
                disabled={busy || wait > 0}
                pendingLabel={t("resending")}
              >
                <ArrowClockwiseIcon />
                {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
              </SubmitButton>
            </form>
            <form action={action} onSubmit={guard()}>
              <input type="hidden" name="intent" value="reset" />
              <SubmitButton variant="link" disabled={busy}>
                <ArrowUUpLeftIcon />
                {t("changeEmail")}
              </SubmitButton>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
