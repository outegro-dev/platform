"use client";

import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { ArrowRightIcon, ArrowUUpLeftIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { type LoginState, loginAction } from "./actions";

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

export function LoginForm({ continueTo }: { continueTo: string }) {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState<LoginState, FormData>(
    loginAction,
    {
      step: "email",
    },
  );
  const wait = useCountdown(
    state.step === "code" ? state.resendIn : undefined,
    state.challengeId,
  );
  const error = state.error
    ? t(`errors.${state.error}` as "errors.invalid_code")
    : null;

  if (state.step === "email") {
    return (
      <form action={action} className="login-form" noValidate>
        <input type="hidden" name="intent" value="request" />
        <div className="field">
          <Label htmlFor="email">{t("email")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder={t("emailPlaceholder")}
            defaultValue={state.email}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        {error && (
          <p id="login-error" role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("sending") : t("sendCode")}
          <ArrowRightIcon />
        </Button>
      </form>
    );
  }

  return (
    <div className="login-form">
      <p className="login-sent" aria-live="polite">
        {t("codeSentTo", { email: state.email ?? "" })}
      </p>
      {state.delivery === "failed" && (
        <p role="alert" className="form-error">
          {t("deliveryFailed")}
        </p>
      )}
      <form action={action} className="login-form" noValidate>
        <input type="hidden" name="intent" value="verify" />
        <input type="hidden" name="continue" value={continueTo} />
        <div className="field">
          <Label htmlFor="code">{t("code")}</Label>
          <Input
            id="code"
            name="code"
            className="code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "login-error" : undefined}
          />
        </div>
        {error && (
          <p id="login-error" role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t("verifying") : t("verify")}
          <ArrowRightIcon />
        </Button>
      </form>
      <div className="login-secondary">
        <form action={action}>
          <input type="hidden" name="intent" value="request" />
          <input type="hidden" name="email" value={state.email ?? ""} />
          <Button type="submit" variant="link" disabled={pending || wait > 0}>
            {wait > 0 ? t("resendIn", { seconds: wait }) : t("resend")}
          </Button>
        </form>
        <form action={action}>
          <input type="hidden" name="intent" value="reset" />
          <Button type="submit" variant="link" disabled={pending}>
            <ArrowUUpLeftIcon />
            {t("changeEmail")}
          </Button>
        </form>
      </div>
    </div>
  );
}
