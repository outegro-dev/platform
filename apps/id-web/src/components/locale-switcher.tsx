"use client";

import { useLocaleSwitch } from "@outegro/i18n/client";
import { localeOptions } from "@outegro/i18n/config";
import { LanguageSwitch } from "@outegro/ui/language-switch";
import { useTranslations } from "next-intl";
import { isOffline } from "@/lib/online";
import { useActionStatus } from "./action-status";

export function LocaleSwitcher() {
  const t = useTranslations("nav");
  const status = useTranslations("status");
  const showStatus = useActionStatus();
  const { locale, change, pending } = useLocaleSwitch({
    onError: () =>
      isOffline()
        ? showStatus(status("offline"), "offline")
        : showStatus(t("languageFailed"), "error"),
  });
  return (
    <LanguageSwitch
      aria-label={t("language")}
      value={locale}
      options={localeOptions}
      onValueChange={(next) =>
        isOffline() ? showStatus(status("offline"), "offline") : change(next)
      }
      pending={pending}
    />
  );
}
