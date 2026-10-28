import { Logger } from "@nestjs/common";
import {
  type CreditItem,
  type CreditResult,
  type DebitInput,
  WalletError,
  type WalletPort,
} from "./wallet.port.js";

type Debit = { input: DebitInput; balance: number; reversed: boolean };

/**
 * The wallet in process memory: tests, and local runs without
 * wallet-backend. It keeps the contract's semantics: refs are unique, a
 * repeat returns the first answer, the same ref with another user or amount
 * is a conflict, a rollback without a debit leaves a tombstone. A player it
 * has not seen starts with the opening balance, which exists only here:
 * production refuses this adapter (WALLET_MODE=http).
 */
export class InMemoryWallet implements WalletPort {
  private readonly logger = new Logger("InMemoryWallet");
  private readonly accounts = new Map<string, number>();
  private readonly debits = new Map<string, Debit>();
  private readonly credits = new Map<
    string,
    { item: CreditItem; balance: number }
  >();
  private readonly tombstones = new Set<string>();

  constructor(private readonly openingBalance: number) {
    this.logger.warn(
      "Grumbles live in process memory (development): one replica, balances reset on restart",
    );
  }

  async debit(input: DebitInput): Promise<{ balance: number }> {
    if (this.tombstones.has(input.ref)) throw new WalletError("conflict");
    const previous = this.debits.get(input.ref);
    if (previous) {
      if (!sameOperation(previous.input, input))
        throw new WalletError("conflict");
      return { balance: previous.balance };
    }
    const current = this.read(input.userId);
    // The real wallet rolls the whole transaction back: the ref stays free.
    if (current < input.amount) throw new WalletError("insufficient_funds");
    const balance = current - input.amount;
    this.accounts.set(input.userId, balance);
    this.debits.set(input.ref, { input, balance, reversed: false });
    return { balance };
  }

  /** All or nothing, as in wallet-backend: one conflicting line refuses the batch. */
  async creditBatch(items: CreditItem[]): Promise<CreditResult[]> {
    for (const item of items) {
      const previous = this.credits.get(item.ref);
      if (previous && !sameOperation(previous.item, item))
        throw new WalletError("conflict");
    }
    return items.map((item) => {
      const previous = this.credits.get(item.ref);
      if (previous)
        return { ref: item.ref, balance: previous.balance, replayed: true };
      const balance = this.read(item.userId) + item.amount;
      this.accounts.set(item.userId, balance);
      this.credits.set(item.ref, { item, balance });
      return { ref: item.ref, balance, replayed: false };
    });
  }

  async rollback(ref: string): Promise<{ status: "reversed" | "tombstoned" }> {
    const debit = this.debits.get(ref);
    if (!debit) {
      this.tombstones.add(ref);
      return { status: "tombstoned" };
    }
    if (!debit.reversed) {
      debit.reversed = true;
      this.accounts.set(
        debit.input.userId,
        this.read(debit.input.userId) + debit.input.amount,
      );
    }
    return { status: "reversed" };
  }

  async balances(userIds: string[]): Promise<Map<string, number>> {
    return new Map(userIds.map((userId) => [userId, this.read(userId)]));
  }

  async balance(userId: string): Promise<number> {
    return this.read(userId);
  }

  /** The balance, opening the account on first touch. */
  private read(userId: string): number {
    const balance = this.accounts.get(userId);
    if (balance !== undefined) return balance;
    this.accounts.set(userId, this.openingBalance);
    return this.openingBalance;
  }
}

/** The wallet's fingerprint: user and amount (meta and reason do not count). */
function sameOperation(a: DebitInput, b: DebitInput): boolean {
  return a.userId === b.userId && a.amount === b.amount;
}
