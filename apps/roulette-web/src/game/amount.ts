/** The quick buttons under the amount: Reset, +10, +100, +1 000, ½, ×2, Max. */
export const quickActions = [
  "clear",
  "add10",
  "add100",
  "add1000",
  "half",
  "double",
  "max",
] as const;
export type QuickAction = (typeof quickActions)[number];

export type AmountLimits = { balance: number; maxBet: number };

/**
 * The amount after a quick button. Never negative, never above the table's
 * maximum; only "Max" looks at the balance (the others may go past it, and
 * the bet then says why it cannot be placed).
 */
export function applyQuick(
  amount: number,
  action: QuickAction,
  limits: AmountLimits,
): number {
  const next = (() => {
    switch (action) {
      case "clear":
        return 0;
      case "add10":
        return amount + 10;
      case "add100":
        return amount + 100;
      case "add1000":
        return amount + 1000;
      case "half":
        return Math.floor(amount / 2);
      case "double":
        return amount * 2;
      case "max":
        return Math.min(limits.balance, limits.maxBet);
    }
  })();
  return Math.max(0, Math.min(limits.maxBet, Math.floor(next)));
}

/** What the player typed, in grumbles: digits with optional spaces; null otherwise. */
export function parseAmount(text: string): number | null {
  // \s covers the no-break spaces of ru-RU grouping too.
  const digits = text.replace(/\s/g, "");
  if (!/^\d{1,15}$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

export type StakeRefusal =
  | "bet_too_small"
  | "bet_too_large"
  | "insufficient_funds";

/** The checks the server makes too, done first so a bad click costs no round trip. */
export function checkAmount(
  amount: number,
  limits: { balance: number; minBet: number; maxBet: number },
): StakeRefusal | null {
  if (!Number.isSafeInteger(amount) || amount < limits.minBet)
    return "bet_too_small";
  if (amount > limits.maxBet) return "bet_too_large";
  if (amount > limits.balance) return "insufficient_funds";
  return null;
}
