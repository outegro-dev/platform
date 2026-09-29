"use client";

import { FormMessage } from "@outegro/ui/form-message";
import { WifiSlashIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { Preferences } from "@/lib/api";
import { useFormFeedback } from "@/lib/form-feedback";
import { type FormState, savePreferences } from "../actions";

const channels = ["inbox", "email", "telegram"] as const;

const keyOf = (item: { category: string; channel: string }) =>
  `${item.category}.${item.channel}`;
const enabledByKey = (preferences: Preferences): Record<string, boolean> =>
  Object.fromEntries(
    preferences.items.map((item) => [keyOf(item), item.enabled]),
  );

/** Category × channel matrix. Required cells stay checked and are not submitted. */
export function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const t = useTranslations("preferences");
  const status = useTranslations("status");
  const [state, action, pending] = useActionState<FormState, FormData>(
    savePreferences,
    { status: "idle" },
  );
  const feedback = useFormFeedback(state, pending);
  // Controlled, so React's form reset after a failed save keeps the edits;
  // a new version from the server replaces them.
  const [enabled, setEnabled] = useState(() => enabledByKey(preferences));
  const [version, setVersion] = useState(preferences.version);
  if (version !== preferences.version) {
    setVersion(preferences.version);
    setEnabled(enabledByKey(preferences));
  }

  const categories = [
    ...new Set(preferences.items.map((item) => item.category)),
  ];
  const cell = (category: string, channel: string) =>
    preferences.items.find(
      (item) => item.category === category && item.channel === channel,
    );
  const editable = preferences.items
    .filter((item) => !item.mandatory)
    .map(keyOf);

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
          <tbody key={feedback.epoch}>
            {categories.map((category) => (
              <tr key={category}>
                <th scope="row">
                  {t(`categories.${category}` as "categories.security")}
                </th>
                {channels.map((channel) => {
                  const item = cell(category, channel);
                  if (!item) return <td key={channel} />;
                  const key = keyOf(item);
                  return (
                    <td key={channel} data-label={t(`channels.${channel}`)}>
                      <label className="check">
                        <input
                          type="checkbox"
                          name={key}
                          checked={enabled[key] ?? item.enabled}
                          onChange={(event) => {
                            setEnabled({
                              ...enabled,
                              [key]: event.target.checked,
                            });
                            feedback.onEdit();
                          }}
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
