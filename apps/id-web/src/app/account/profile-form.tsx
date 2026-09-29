"use client";

import { FormMessage } from "@outegro/ui/form-message";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { WifiSlashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { useFormFeedback } from "@/lib/form-feedback";
import { type FormState, updateProfile } from "./actions";

export function ProfileForm(props: {
  version: number;
  displayName: string | null;
  locale: "en" | "ru";
}) {
  const t = useTranslations("profile");
  const status = useTranslations("status");
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateProfile,
    { status: "idle" },
  );
  const feedback = useFormFeedback(state, pending);
  // Controlled, so React's form reset after a failed save keeps the edits.
  const [displayName, setDisplayName] = useState(props.displayName ?? "");
  const [locale, setLocale] = useState(props.locale);
  // A new version from the server (saved here or elsewhere) replaces them.
  const [version, setVersion] = useState(props.version);
  if (version !== props.version) {
    setVersion(props.version);
    setDisplayName(props.displayName ?? "");
    setLocale(props.locale);
  }

  const result = feedback.phase === "result" ? state.status : null;
  const text =
    feedback.phase === "pending"
      ? t("saving")
      : feedback.phase === "offline"
        ? status("offline")
        : result === "saved"
          ? t("saved")
          : result === "conflict"
            ? t("conflict")
            : result === "invalid"
              ? t("invalid")
              : result === "error"
                ? t("unavailable")
                : "";
  const tone =
    result === "saved"
      ? "success"
      : feedback.phase === "offline" || (result && result !== "idle")
        ? "error"
        : "neutral";

  return (
    <form action={action} onSubmit={feedback.onSubmit} className="stack">
      <input type="hidden" name="expectedVersion" value={props.version} />
      <div className="field">
        <Label htmlFor="displayName">{t("displayName")}</Label>
        <Input
          id="displayName"
          name="displayName"
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            feedback.onEdit();
          }}
          placeholder={t("displayNamePlaceholder")}
          maxLength={80}
          autoComplete="name"
        />
      </div>
      <fieldset className="field">
        <legend className="field-legend">{t("language")}</legend>
        <div className="choices" key={feedback.epoch}>
          {(["en", "ru"] as const).map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="locale"
                value={value}
                checked={locale === value}
                onChange={() => {
                  setLocale(value);
                  feedback.onEdit();
                }}
              />
              {value === "en" ? "English" : "Русский"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-actions">
        <SubmitButton pendingLabel={t("saving")}>{t("save")}</SubmitButton>
        <FormMessage
          role="status"
          className="form-status items-center"
          lines={2}
          tone={tone}
          icon={
            feedback.phase === "offline" ? (
              <WifiSlashIcon weight="bold" />
            ) : undefined
          }
        >
          {text}
        </FormMessage>
      </div>
    </form>
  );
}
