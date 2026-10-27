import type { Color } from "@outegro/roulette-engine";

/**
 * The chips wallet as roulette sees it: the seamless-wallet contract of
 * wallet-backend (docs/02-contracts/roulette.md). Every operation is keyed
 * by `ref`, unique in the wallet, so a retry repeats the first answer.
 */
export interface WalletPort {
  /** Takes chips for a bet; the answer is the balance after it. */
  debit(input: DebitInput): Promise<{ balance: number }>;
  /** Pays winnings, up to 1 000 items per call; duplicates are no-ops. */
  creditBatch(items: CreditItem[]): Promise<CreditResult[]>;
  /**
   * Reverses the debit with this ref. Without one it leaves a tombstone, and
   * a debit arriving later with that ref gets a conflict (409).
   */
  rollback(ref: string): Promise<{ status: "reversed" | "tombstoned" }>;
  balance(userId: string): Promise<number>;
}

export type WalletMeta = { game: "roulette"; round: number; color: Color };

export type DebitInput = {
  userId: string;
  amount: number;
  ref: string;
  meta: WalletMeta;
};

export type CreditItem = DebitInput;

export type CreditResult = { ref: string; status: "applied" | "duplicate" };

/** The most items one creditBatch call takes. */
export const CREDIT_BATCH_LIMIT = 1000;

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
