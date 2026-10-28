import { z } from "zod";

/**
 * wallet-backend's `GET /v1/me/wallet`: `{ unit, balance, state, exists,
 * updatedAt }`. The balance is a bigint on the wire and may come as a
 * string; anything that is not a whole non-negative number reads as unknown.
 */
const walletSchema = z.object({
  unit: z.string(),
  balance: z.union([z.string(), z.number()]).nullable(),
});

export function balanceOf(body: unknown): number | null {
  const parsed = walletSchema.safeParse(body);
  if (!parsed.success || parsed.data.unit !== "GRM") return null;
  const raw = parsed.data.balance;
  if (raw === null) return null;
  const value =
    typeof raw === "number"
      ? raw
      : /^\d{1,15}$/.test(raw)
        ? Number(raw)
        : Number.NaN;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
