import type { Money } from "./payments/model";

/*
 * Money and dates for people, the same on the server and in the browser.
 * Money never passes through a float: the exact decimal string goes to
 * Intl.NumberFormat, so any amount in minor units is shown as it is.
 */

/**
 * "299 ₽", "$0.59", "0,52 €". A whole amount drops the zero fraction unless
 * `exact` asks for the currency's digits (receipts: "50,00 ₽").
 */
export function formatMoney(
  money: Money,
  locale: string,
  { exact = false }: { exact?: boolean } = {},
): string {
  const minor = BigInt(money.minor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(money.scale);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const digits =
    money.scale > 0 && (exact || fraction !== 0n) ? money.scale : 0;
  const decimal = digits
    ? `${whole}.${fraction.toString().padStart(money.scale, "0")}`
    : `${whole}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(`${negative ? "-" : ""}${decimal}` as Intl.StringNumericLiteral);
}

/** A time zone the runtime knows, otherwise UTC. */
export function safeTimeZone(value: string | null | undefined): string {
  if (!value || value.length > 64) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/**
 * Russian dates end in "г." ("29 сент. 2026 г."), which doubles the full
 * stop of a sentence that ends with a date. Interfaces commonly drop it.
 */
function withoutYearMark(parts: Intl.DateTimeFormatPart[]) {
  return parts
    .map((part) =>
      part.type === "literal" ? part.value.replace(/\s?г\./, "") : part.value,
    )
    .join("");
}

/** "Sep 29, 2026" / "29 сент. 2026", in the viewer's time zone. */
export function formatDate(iso: string, locale: string, timeZone: string) {
  return withoutYearMark(
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone,
    }).formatToParts(new Date(iso)),
  );
}

/** "Sep 29, 2026, 14:03" with the time, for receipts and timelines. */
export function formatDateTime(iso: string, locale: string, timeZone: string) {
  return withoutYearMark(
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).formatToParts(new Date(iso)),
  );
}

export type Formatters = {
  money: (money: Money, options?: { exact?: boolean }) => string;
  date: (iso: string) => string;
  dateTime: (iso: string) => string;
};

export function formatters(locale: string, timeZone: string): Formatters {
  return {
    money: (money, options) => formatMoney(money, locale, options),
    date: (iso) => formatDate(iso, locale, timeZone),
    dateTime: (iso) => formatDateTime(iso, locale, timeZone),
  };
}
