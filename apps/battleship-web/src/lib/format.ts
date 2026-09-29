/** 83 → "1:23". */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/*
 * Dates always name their time zone: pages render on the server (UTC in the
 * container) and hydrate in the browser, so an implicit zone would differ
 * between the two and break hydration. Calendar days of the game (the week
 * starts Monday 00:00 UTC) are UTC; moments are shown in the browser's zone
 * once it is known (useTimeZone).
 */
export function formatDate(
  iso: string,
  locale: string,
  timeZone = "UTC",
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(iso));
}

export function formatDateTime(
  iso: string,
  locale: string,
  timeZone = "UTC",
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/** 0.4567 → "46%" (null → null). */
export function formatPercent(
  value: number | null,
  locale: string,
): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);
}

/** +16 / −12 / 0 with a real minus sign. */
export function formatSigned(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { signDisplay: "exceptZero" })
    .format(value)
    .replace("-", "−");
}

export function formatNumber(
  value: number,
  locale: string,
  digits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value);
}
