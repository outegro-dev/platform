/**
 * Exact money: integer minor units (bigint) plus currency metadata.
 * External decimals are parsed from their text form; nothing is rounded.
 */
export const currencyScale = { RUB: 2, USD: 2, EUR: 2 } as const;
export type Currency = keyof typeof currencyScale;
export const currencies = Object.keys(currencyScale) as [
  Currency,
  ...Currency[],
];

export class MoneyError extends Error {}

export const isCurrency = (value: unknown): value is Currency =>
  typeof value === "string" && value in currencyScale;

const DECIMAL = /^(\d{1,13})(?:\.(\d{1,20}))?$/;

/**
 * A JSON number as the literal the sender wrote. `String(n)` is the shortest
 * round-trip form, which equals the literal for amounts with up to 15
 * significant digits; exponent forms and negatives are refused.
 */
function numberToDecimal(value: number) {
  if (!Number.isFinite(value) || value < 0)
    throw new MoneyError("amount must be a finite non-negative number");
  const text = String(value);
  if (/e/i.test(text)) throw new MoneyError("amount out of range");
  return text;
}

/** "0.59" or 0.59 in USD → 59n. More fraction digits than the currency has is an error. */
export function toMinor(value: string | number, currency: Currency): bigint {
  const text =
    typeof value === "number" ? numberToDecimal(value) : value.trim();
  const match = DECIMAL.exec(text);
  if (!match?.[1]) throw new MoneyError("amount is not a decimal number");
  const scale = currencyScale[currency];
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > scale)
    throw new MoneyError(`amount has more than ${scale} fraction digits`);
  return (
    BigInt(match[1]) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, "0") || "0")
  );
}

/** 59n USD → "0.59"; 5000n RUB → "50.00". */
export function formatMinor(minor: bigint, currency: Currency): string {
  const scale = currencyScale[currency];
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor)
    .toString()
    .padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale);
  return `${negative ? "-" : ""}${whole}${scale ? `.${fraction}` : ""}`;
}

/** HTTP/event shape: `{ minor: "59", currency: "USD", scale: 2 }`. */
export function moneyDto(minor: bigint, currency: Currency) {
  return {
    minor: minor.toString(),
    currency,
    scale: currencyScale[currency],
  };
}

/** For messages to people: "0.59 USD". */
export const displayMoney = (minor: bigint, currency: Currency) =>
  `${formatMinor(minor, currency)} ${currency}`;
