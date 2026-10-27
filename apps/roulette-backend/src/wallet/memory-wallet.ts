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
 * The chips wallet in process memory, until wallet-backend has its internal
 * API (ADR-012). It keeps the contract's semantics: refs are unique, a
 * repeat returns the first answer, the same ref with other data is a
 * conflict, a rollback without a debit leaves a tombstone, and a new player
 * gets the starter chips once. Balances die with the process, so the service
 * runs as one replica while this adapter is in use.
 */
export class InMemoryWallet implements WalletPort {
  private readonly logger = new Logger("InMemoryWallet");
  private readonly balances = new Map<string, number>();
  private readonly debits = new Map<string, Debit>();
  private readonly credits = new Map<string, CreditItem>();
  private readonly tombstones = new Set<string>();

  constructor(private readonly starterChips: number) {
    this.logger.warn(
      "Chips live in process memory: one replica, balances reset on restart",
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
    this.balances.set(input.userId, balance);
    this.debits.set(input.ref, { input, balance, reversed: false });
    return { balance };
  }

  async creditBatch(items: CreditItem[]): Promise<CreditResult[]> {
    return items.map((item) => {
      const previous = this.credits.get(item.ref);
      if (previous) {
        if (!sameOperation(previous, item)) throw new WalletError("conflict");
        return { ref: item.ref, status: "duplicate" };
      }
      this.credits.set(item.ref, item);
      this.balances.set(item.userId, this.read(item.userId) + item.amount);
      return { ref: item.ref, status: "applied" };
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
      this.balances.set(
        debit.input.userId,
        this.read(debit.input.userId) + debit.input.amount,
      );
    }
    return { status: "reversed" };
  }

  async balance(userId: string): Promise<number> {
    return this.read(userId);
  }

  /** The balance, opening the account with the starter chips on first touch. */
  private read(userId: string): number {
    const balance = this.balances.get(userId);
    if (balance !== undefined) return balance;
    this.balances.set(userId, this.starterChips);
    return this.starterChips;
  }
}

function sameOperation(a: DebitInput, b: DebitInput): boolean {
  return (
    a.userId === b.userId &&
    a.amount === b.amount &&
    a.meta.round === b.meta.round &&
    a.meta.color === b.meta.color
  );
}
