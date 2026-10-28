import { formatNumber } from "@/lib/format";
import { grm, type RouletteColor } from "@/lib/roulette";

/**
 * Small pieces of the roulette screens, without hooks or server calls:
 * server pages and the live board (a client component) use the same ones.
 */

/** A colour of the wheel: its swatch (with the number, when there is one) and name. */
export function ColorChip({
  color,
  number,
  label,
}: {
  color: RouletteColor;
  number?: number | null;
  label: string;
}) {
  return (
    <span className="rl-color">
      <span className="rl-swatch" data-color={color} aria-hidden="true">
        {number ?? ""}
      </span>
      <span>
        {number !== undefined && number !== null ? (
          <>
            <span className="num">{number}</span>{" "}
            <span className="muted">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}

/** "+1,234" / "−1,234" (a real minus) / "0", grouped in the operator's language. */
export function signed(value: number, locale: string): string {
  const text = formatNumber(Math.abs(value), locale);
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

/** Grumbles: a whole number and the unit, never a currency sign. */
export function Grm({
  amount,
  locale,
  sign = false,
  tone = false,
}: {
  amount: number;
  locale: string;
  /** Show + for gains (results, not stakes). */
  sign?: boolean;
  /** Colour gains and losses (the house's or a player's result). */
  tone?: boolean;
}) {
  const text = sign ? signed(amount, locale) : formatNumber(amount, locale);
  return (
    <span
      className="num nowrap"
      data-result={
        tone ? (amount > 0 ? "up" : amount < 0 ? "down" : undefined) : undefined
      }
    >
      {text} <span className="rl-unit">{grm}</span>
    </span>
  );
}
