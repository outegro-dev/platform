"use client";

import { Button } from "@outegro/ui/button";
import { Input } from "@outegro/ui/input";
import { Label } from "@outegro/ui/label";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type FormState, updateProfile } from "./actions";

export function ProfileForm(props: {
  version: number;
  displayName: string | null;
  locale: "en" | "ru";
}) {
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateProfile,
    {
      status: "idle",
    },
  );
  return (
    <form action={action} className="stack">
      <input type="hidden" name="expectedVersion" value={props.version} />
      <div className="field">
        <Label htmlFor="displayName">{t("displayName")}</Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={props.displayName ?? ""}
          placeholder={t("displayNamePlaceholder")}
          maxLength={80}
          autoComplete="name"
        />
      </div>
      <fieldset className="field">
        <legend className="field-legend">{t("language")}</legend>
        <div className="choices">
          {(["en", "ru"] as const).map((value) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="locale"
                value={value}
                defaultChecked={props.locale === value}
              />
              {value === "en" ? "English" : "Русский"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="form-actions">
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <p className="form-status" role="status" data-status={state.status}>
          {state.status === "saved" && t("saved")}
          {state.status === "conflict" && t("conflict")}
          {state.status === "invalid" && t("invalid")}
          {state.status === "error" && t("unavailable")}
        </p>
      </div>
    </form>
  );
}
