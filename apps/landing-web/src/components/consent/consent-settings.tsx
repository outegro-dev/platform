"use client";

import { ToggleGroup, ToggleGroupItem } from "@outegro/ui/toggle-group";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { type Consent, parseConsent } from "./consent";
import { saveConsent, useConsent } from "./use-consent";
import "./consent.css";

/**
 * «Настройки статистики» on the privacy page: the note's question again,
 * the stored answer as a pair of radio buttons, changeable at any time.
 * Withdrawing wipes GA's cookies.
 */
export function ConsentSettings({ initial }: { initial?: Consent }) {
  const question = useTranslations("consent");
  const t = useTranslations("consent.settings");
  const label = useId();
  const consent = useConsent(initial);
  return (
    <div className="consent-settings">
      <p id={label} className="consent-settings-label">
        {question("title")}
      </p>
      <ToggleGroup
        type="single"
        variant="segmented"
        aria-labelledby={label}
        value={consent ?? ""}
        onValueChange={(value: string) => {
          const next = parseConsent(value);
          if (next) saveConsent(next);
        }}
      >
        <ToggleGroupItem value="granted">{t("granted")}</ToggleGroupItem>
        <ToggleGroupItem value="denied">{t("denied")}</ToggleGroupItem>
      </ToggleGroup>
      <p role="status" className="consent-settings-state">
        {t(consent ? `state.${consent}` : "state.unset")}
      </p>
    </div>
  );
}
