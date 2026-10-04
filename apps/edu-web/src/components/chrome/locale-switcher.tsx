"use client";

import { useLocaleSwitch } from "@outegro/i18n/client";
import { localeOptions } from "@outegro/i18n/config";
import { LanguageSwitch } from "@outegro/ui/language-switch";
import { useTranslations } from "next-intl";
import { isOffline } from "@/lib/browser";
import { useActionStatus } from "./action-status";

/**
 * EN / RU for the interface (the books keep their own language). Offline
 * the switch is explained at once; a switch the server did not take keeps
 * the current language and says so.
 */
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
