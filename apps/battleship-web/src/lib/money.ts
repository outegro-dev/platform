import type { Money } from "@outegro/contracts";

/**
 * Formats money from its exact form (integer minor units as a string plus
 * the currency's scale) without going through a float. A whole amount drops
 * the zero fraction ("299 ₽", not "299,00 ₽"); otherwise the currency's own
 * number of digits is shown.
 */
export function formatMoney(money: Money, locale: string): string {
  const minor = BigInt(money.minor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const divisor = 10n ** BigInt(money.scale);
  const whole = absolute / divisor;
  const fraction = absolute % divisor;
  const exact = money.scale > 0 && fraction !== 0n;
  const decimal = exact
    ? `${whole}.${fraction.toString().padStart(money.scale, "0")}`
    : `${whole}`;
  const digits = exact ? money.scale : 0;
  // A decimal string keeps precision beyond Number.MAX_SAFE_INTEGER.
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: money.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(`${negative ? "-" : ""}${decimal}` as Intl.StringNumericLiteral);
}
