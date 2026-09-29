import { cookies, headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { cache } from "react";
import { PATH_HEADER, TZ_COOKIE } from "./constants";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
  formatUtc,
  type Money,
  safeTimeZone,
} from "./format";

export async function currentPath(): Promise<string> {
  return (await headers()).get(PATH_HEADER) ?? "/";
}

export function signInPath(returnTo: string): string {
  return `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`;
}

export const operatorTimeZone = cache(async () =>
  safeTimeZone((await cookies()).get(TZ_COOKIE)?.value),
);

export type Formatter = {
  locale: string;
  timeZone: string;
  now: number;
  dateTime: (iso: string) => string;
  date: (iso: string) => string;
  utc: (iso: string) => string;
  relative: (iso: string) => string;
  money: (money: Money) => string;
  number: (value: number) => string;
  percent: (ratio: number, digits?: number) => string;
  duration: (ms: number) => string;
};

/** Formatting in the operator's language and time zone, once per request. */
export const getFormatter = cache(async (): Promise<Formatter> => {
  const locale = await getLocale();
  const timeZone = await operatorTimeZone();
  const now = Date.now();
  return {
    locale,
    timeZone,
    now,
    dateTime: (iso) => formatDateTime(iso, locale, timeZone),
    date: (iso) => formatDate(iso, locale, timeZone),
    utc: formatUtc,
    relative: (iso) => formatRelative(iso, now, locale),
    money: (money) => formatMoney(money, locale),
    number: (value) => formatNumber(value, locale),
    percent: (ratio, digits) => formatPercent(ratio, locale, digits),
    duration: (ms) => formatDuration(ms, locale),
  };
});
