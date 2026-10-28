/*
 * Formatting shared by server and client components. Every function takes
 * the locale and the owner's time zone explicitly (from the request), so the
 * server and the browser print the same text and hydration never differs.
 */

/** A valid IANA zone, or UTC. */
export function safeTimeZone(value: string | null | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

/** "28 Oct, 14:05" in the owner's zone. */
export function formatDateTime(
  iso: string,
  locale: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** "28 Oct 2026" in the owner's zone. */
export function formatDate(
  iso: string,
  locale: string,
  timeZone: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(iso));
}

export type Age = { unit: "now" | "m" | "h" | "d" | "w"; n: number };

/** How long ago, in the one unit a card has room for. */
export function ageOf(iso: string, now: number): Age {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return { unit: "now", n: 0 };
  if (minutes < 60) return { unit: "m", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "h", n: hours };
  const days = Math.floor(hours / 24);
  if (days < 14) return { unit: "d", n: days };
  return { unit: "w", n: Math.floor(days / 7) };
}

/** "in 2 hours", "5 minutes ago": the nearest whole unit. */
export function formatRelative(iso: string, now: number, locale: string) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}

/** 850 ms, 1.4 s, 3 min. */
export function formatDuration(ms: number, locale: string): string {
  const unit = (value: number, name: "millisecond" | "second" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "short",
      maximumFractionDigits: name === "second" && value < 10 ? 1 : 0,
    }).format(value);
  if (ms < 1000) return unit(ms, "millisecond");
  if (ms < 60_000) return unit(ms / 1000, "second");
  return unit(ms / 60_000, "minute");
}

/** 0.92 → "92%". */
export function formatPercent(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(ratio);
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** 6000 EUR → "€6,000"; an unknown currency code prints as it is. */
export function formatMoney(
  amount: number,
  currency: string,
  locale: string,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${formatNumber(amount, locale)} ${currency}`;
  }
}

/** The tone of a fit score: strong, fair or weak (null: not scored). */
export function scoreTone(score: number | null): "ok" | "neutral" | "warn" {
  if (score === null) return "neutral";
  if (score >= 80) return "ok";
  if (score >= 65) return "neutral";
  return "warn";
}
