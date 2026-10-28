"use client";

import { useLocaleSwitch } from "@outegro/i18n/client";
import { localeOptions } from "@outegro/i18n/config";
import { LanguageSwitch } from "@outegro/ui/language-switch";
import { useTranslations } from "next-intl";

export function LocaleSwitcher() {
  const t = useTranslations("nav");
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
