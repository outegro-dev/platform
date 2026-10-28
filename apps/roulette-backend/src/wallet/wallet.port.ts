import type { Color } from "@outegro/roulette-engine";

/**
 * The grumbles wallet as roulette sees it: the internal API of
 * wallet-backend (docs/02-contracts/roulette.md, ADR-011). Every operation
 * is keyed by `ref`, unique in the wallet, so a retry repeats the first
 * answer; every call says its source, `roulette`.
 */
export interface WalletPort {
  /** Takes grumbles for a bet; the answer is the balance after it. */
  debit(input: DebitInput): Promise<{ balance: number }>;
  /** Pays winnings, up to 1 000 items per call; a repeat changes nothing. */
  creditBatch(items: CreditItem[]): Promise<CreditResult[]>;
  /**
   * Reverses the debit with this ref. Without one it leaves a tombstone, and
   * a debit arriving later with that ref gets a conflict (409).
   */
  rollback(ref: string): Promise<{ status: "reversed" | "tombstoned" }>;
  /** Balances of many players in one go; a player without a wallet has 0. */
  balances(userIds: string[]): Promise<Map<string, number>>;
}

/** Kept with the operation so reconciliation can rebuild a lost bet. */
export type WalletMeta = { round: number; color: Color };

export type DebitInput = {
  userId: string;
  amount: number;
  ref: string;
  /** The object the operation is about: `round:{k}`. */
  objectRef: string;
  meta: WalletMeta;
};

export type CreditItem = DebitInput;

/** One credited item: the balance right after it, and whether it was a repeat. */
export type CreditResult = { ref: string; balance: number; replayed: boolean };

/** The most items one creditBatch call takes. */
export const CREDIT_BATCH_LIMIT = 1000;

/** The wallet's unit for roulette (owner, 28.10.2026). */
export const WALLET_UNIT = "GRM";
/** The wallet's name for operations of this service. */
export const WALLET_SOURCE = "roulette";

export const roundObject = (round: number) => `round:${round}`;

/**
 * One player's balance for a screen, or null when the wallet does not
 * answer: a missing figure must not keep anyone out of the game.
 */
export async function balanceOrNull(
  wallet: WalletPort,
  userId: string,
): Promise<number | null> {
  try {
    return (await wallet.balances([userId])).get(userId) ?? null;
  } catch {
    return null;
  }
}

export type WalletErrorCode =
  /** 402 INSUFFICIENT_FUNDS */
  | "insufficient_funds"
  /** 423 WALLET_RESTRICTED */
  | "restricted"
  /** 409: the same ref with other data, or a debit after its rollback. */
  | "conflict"
  /** No answer: the operation may or may not have happened. */
  | "unavailable";

export class WalletError extends Error {
  constructor(readonly code: WalletErrorCode) {
    super(`wallet: ${code}`);
  }
}
