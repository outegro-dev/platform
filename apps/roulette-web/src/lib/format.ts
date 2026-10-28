/** Grumbles with locale grouping, as the mock shows amounts: 12 500. */
export function formatAmount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

/** Seconds with one decimal: 12.3 / 12,3. */
export function formatSeconds(ms: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0, ms) / 1000);
}

/** A chance in percent with at most one decimal: 2.5 / 2,5. */
export function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}
