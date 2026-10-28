"use client";

import { useLocale } from "next-intl";
import { createContext, type ReactNode, use } from "react";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRelative,
} from "@/lib/format";

const TimeZoneContext = createContext("UTC");

/** The owner's time zone for client components (from the og_tz cookie). */
export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  return <TimeZoneContext value={timeZone}>{children}</TimeZoneContext>;
}

/** Formatting in the page's language and the owner's zone, same on server and client. */
export function useFormat() {
  const locale = useLocale();
  const timeZone = use(TimeZoneContext);
  return {
    locale,
    dateTime: (iso: string) => formatDateTime(iso, locale, timeZone),
    date: (iso: string) => formatDate(iso, locale, timeZone),
    relative: (iso: string, now: number) => formatRelative(iso, now, locale),
    duration: (ms: number) => formatDuration(ms, locale),
    percent: (ratio: number) => formatPercent(ratio, locale),
    number: (value: number) => formatNumber(value, locale),
    money: (amount: number, currency: string) =>
      formatMoney(amount, currency, locale),
  };
}
