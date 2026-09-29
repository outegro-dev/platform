import type { Locale } from "./registry.js";

/*
 * Money and dates in messages, by the rules pay-web shows them: minor units
 * reach Intl as an exact decimal string (never a float), in the reader's
 * language. Recipients have no known time zone, so times are UTC and say so.
 */

/** "₽50.00" / "50,00 ₽": every digit of the currency, as on a receipt. */
export function formatMoney(
  minor: string,
  currency: string,
  scale: number,
  locale: Locale,
) {
  const value = BigInt(minor);
  const divisor = 10n ** BigInt(scale);
  const fraction = (value % divisor).toString().padStart(scale, "0");
  const decimal = scale ? `${value / divisor}.${fraction}` : `${value}`;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(decimal as Intl.StringNumericLiteral);
}

/** "Sep 29, 2026, 2:03 PM UTC" / "29 сент. 2026, 14:03 UTC". */
export function formatDateTime(iso: string, locale: Locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).formatToParts(new Date(iso));
  // Russian dates carry "г.", which reads badly inside a sentence.
  const text = parts
    .map((part) =>
      part.type === "literal" ? part.value.replace(/\s?г\./, "") : part.value,
    )
    .join("");
  return `${text} UTC`;
}
