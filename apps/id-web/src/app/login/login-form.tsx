"use client";

import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { ArrowRightIcon, ArrowUUpLeftIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { type LoginState, loginAction } from "./actions";

function useCountdown(until?: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((Date.parse(until) - now) / 1000)) : 0;
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
    state.step === "code" ? state.resendAfter : undefined,
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
