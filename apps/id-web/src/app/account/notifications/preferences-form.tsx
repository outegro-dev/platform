"use client";

import { Button } from "@outegro/ui/button";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { Preferences } from "@/lib/api";
import { type FormState, savePreferences } from "../actions";

const channels = ["inbox", "email", "telegram"] as const;

/** Category × channel matrix. Required cells stay checked and are not submitted. */
export function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const t = useTranslations("preferences");
  const [state, action, pending] = useActionState<FormState, FormData>(
    savePreferences,
    {
      status: "idle",
    },
  );
  const categories = [
    ...new Set(preferences.items.map((item) => item.category)),
  ];
  const cell = (category: string, channel: string) =>
    preferences.items.find(
      (item) => item.category === category && item.channel === channel,
    );
  const editable = preferences.items
    .filter((item) => !item.mandatory)
    .map((item) => `${item.category}.${item.channel}`);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="version" value={preferences.version} />
      <input type="hidden" name="keys" value={editable.join(",")} />
      <div className="matrix-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <td />
              {channels.map((channel) => (
                <th key={channel} scope="col">
                  {t(`channels.${channel}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category}>
                <th scope="row">
                  {t(`categories.${category}` as "categories.security")}
                </th>
                {channels.map((channel) => {
                  const item = cell(category, channel);
                  if (!item) return <td key={channel} />;
                  return (
                    <td key={channel} data-label={t(`channels.${channel}`)}>
                      <label className="check">
                        <input
                          type="checkbox"
                          name={`${category}.${channel}`}
                          defaultChecked={item.enabled}
                          disabled={item.mandatory}
                          aria-label={`${t(`categories.${category}` as "categories.security")}: ${t(`channels.${channel}`)}`}
                        />
                        {item.mandatory && (
                          <span className="check-note">{t("required")}</span>
                        )}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">{t("telegramHint")}</p>
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
