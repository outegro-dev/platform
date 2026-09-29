/**
 * Formatting shared by every screen: money from minor units, dates in the
 * operator's locale and time zone (UTC on hover), numbers and durations.
 */

export type Money = { minor: string; currency: string; scale: number };

/** "12345" with scale 2 → "123.45" without floating point. */
export function minorToDecimal(minor: string, scale: number): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale > 0 ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/** 5000 RUB minor → "50,00 ₽" (ru) or "RUB 50.00" (en); exact for any size. */
export function formatMoney(money: Money, locale: string): string {
  const decimal = minorToDecimal(money.minor, money.scale);
  try {
    const format = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: money.scale,
      maximumFractionDigits: money.scale,
    });
    // Intl formats decimal strings exactly: no rounding through Number.
    return format.format(decimal as `${number}`);
  } catch {
    return `${decimal} ${money.currency}`;
  }
}

export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** 0.4567 → "46%" (or "45.7%" with one digit). */
export function formatPercent(
  ratio: number,
  locale: string,
  digits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(ratio);
}

/** A time zone the runtime knows, otherwise UTC. */
export function safeTimeZone(value: string | null | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

export function formatDateTime(
  iso: string,
  locale: string,
  timeZone: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

export function formatDate(
  iso: string,
  locale: string,
  timeZone: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone,
  }).format(date);
}

/** Exact UTC for tooltips: "2026-09-29 14:03:12 UTC". */
export function formatUtc(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

const RELATIVE_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

/** "5 minutes ago" / "in 2 hours", relative to `now`. */
export function formatRelative(
  iso: string,
  now: number,
  locale: string,
): string {
  let value = (new Date(iso).getTime() - now) / 1000;
  if (Number.isNaN(value)) return iso;
  for (const [unit, size] of RELATIVE_STEPS) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
        Math.round(value),
        unit,
      );
    }
    value /= size;
  }
  return iso;
}

/** 95 000 ms → "1 min 35 sec"; hours and minutes above an hour. */
export function formatDuration(ms: number, locale: string): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const unit = (value: number, name: "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "short",
    }).format(value);
  if (seconds < 60) return unit(seconds, "second");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const rest = seconds % 60;
    return rest
      ? `${unit(minutes, "minute")} ${unit(rest, "second")}`
      : unit(minutes, "minute");
  }
  const hours = Math.floor(minutes / 60);
  if (hours >= 48 && hours % 24 === 0)
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit: "day",
      unitDisplay: "long",
    }).format(hours / 24);
  const rest = minutes % 60;
  return rest
    ? `${unit(hours, "hour")} ${unit(rest, "minute")}`
    : unit(hours, "hour");
}

/** "anna@example.com" → "a***@example.com" (for roles without PII access). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** Masks every email address inside free text or serialized JSON. */
export function maskEmailsIn(text: string): string {
  return text.replace(
    /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    "$1***@$2",
  );
}

/** Board coordinate as players say it: x 0..9 → A..J, y 0..9 → 1..10. */
export function coordinate(x: number, y: number): string {
  return `${String.fromCharCode(65 + x)}${y + 1}`;
}

/** Short id for dense tables: the first 8 characters of a uuid. */
export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 8) : id;
}

/** The last `days` UTC days ending today, oldest first, as "YYYY-MM-DD". */
export function lastDays(days: number, now: number): string[] {
  const date = new Date(now);
  const today = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Array.from({ length: days }, (_, index) =>
    new Date(today - (days - 1 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

/** Axis label for a UTC day in the operator's locale: "29 Sep". */
export function dayLabel(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}
