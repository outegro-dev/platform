"use client";

import { useLocaleSwitch } from "@outegro/i18n/client";
import { localeOptions } from "@outegro/i18n/config";
import { LanguageSwitch } from "@outegro/ui/language-switch";
import { useTranslations } from "next-intl";

/** EN/RU through the shared `og_locale` cookie; the page re-renders on the server. */
export function LocaleSwitcher() {
  const t = useTranslations("shell");
  const { locale, change, pending } = useLocaleSwitch();
  return (
    <LanguageSwitch
      aria-label={t("language")}
      value={locale}
      options={localeOptions}
      onValueChange={change}
      pending={pending}
    />
  );
}
