import { isLocale } from "@outegro/i18n/config";
import { getRequestLocale } from "@outegro/i18n/server";
import { getRequestConfig } from "next-intl/server";
import { operatorTimeZone } from "@/lib/request";

/**
 * Language from the shared `og_locale` cookie (English by default), time
 * zone from the operator's browser (`og_tz`), messages per language.
 */
export default getRequestConfig(async ({ locale: override }) => {
  const locale = isLocale(override) ? override : await getRequestLocale();
  return {
    locale,
    timeZone: await operatorTimeZone(),
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
