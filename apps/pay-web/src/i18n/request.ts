import { isLocale } from "@outegro/i18n/config";
import { getRequestLocale } from "@outegro/i18n/server";
import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { safeTimeZone } from "@/lib/format";
import { TIME_ZONE_COOKIE } from "@/lib/time-zone";

/**
 * Language from the shared `og_locale` cookie (EN by default), plus the
 * viewer's time zone once the browser has told us (`og_tz`), so dates render
 * the same on the server and in the browser.
 */
export default getRequestConfig(async ({ locale: override }) => {
  const locale = isLocale(override) ? override : await getRequestLocale();
  const timeZone = safeTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return {
    locale,
    timeZone,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
