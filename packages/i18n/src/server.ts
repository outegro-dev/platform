import { cookies } from "next/headers";
import type { AbstractIntlMessages } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/** Locale for the current request: the shared cookie, otherwise English. */
export async function getRequestLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

/**
 * Default export for an app's `src/i18n/request.ts`:
 * `export default createRequestConfig((l) => import(`../messages/${l}.json`))`.
 */
export function createRequestConfig(
  load: (locale: Locale) => Promise<{ default: AbstractIntlMessages }>,
) {
  return getRequestConfig(async ({ locale: override }) => {
    const locale = isLocale(override) ? override : await getRequestLocale();
    return { locale, messages: (await load(locale)).default };
  });
}
