import { cookies, headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { PATH_HEADER, TZ_COOKIE } from "./constants";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatRelative,
  safeTimeZone,
} from "./format";

/** The requested path (set by the proxy), for return-after-sign-in. */
export async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/";
}

export const ownerTimeZone = cache(async () =>
  safeTimeZone((await cookies()).get(TZ_COOKIE)?.value),
);

/** Formatting for server components: the request's language, zone and clock. */
export const getFormatter = cache(async () => {
  const locale = await getLocale();
  const timeZone = await ownerTimeZone();
  const now = Date.now();
  return {
    locale,
    timeZone,
    now,
    dateTime: (iso: string) => formatDateTime(iso, locale, timeZone),
    date: (iso: string) => formatDate(iso, locale, timeZone),
    relative: (iso: string) => formatRelative(iso, now, locale),
    duration: (ms: number) => formatDuration(ms, locale),
    percent: (ratio: number) => formatPercent(ratio, locale),
    number: (value: number) => formatNumber(value, locale),
  };
});
