import { Inject, Injectable } from "@nestjs/common";
import type {
  BalanceItem,
  HistoryItem,
  WalletSource,
  WalletUnit,
  WalletView,
} from "@outegro/contracts/wallet";
import { DATABASE } from "@outegro/nest-common";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { TxRow, WalletDatabase } from "../common/database.js";
import { decodeVersionCursor, encodeVersionCursor } from "../common/pages.js";
import { users, wallets, walletTx } from "../db/schema.js";

export const historyItem = (row: TxRow): HistoryItem => ({
  id: row.id,
  kind: row.kind,
  source: row.source,
  amount: row.amount.toString(),
  balanceBefore: row.balanceBefore.toString(),
  balanceAfter: row.balanceAfter.toString(),
  createdAt: row.createdAt.toISOString(),
});

/** A player's own wallet and history (INV-10: the user comes from the token). */
@Injectable()
export class AccountService {
  constructor(@Inject(DATABASE) private readonly database: WalletDatabase) {}

  async wallet(userId: string, unit: WalletUnit): Promise<WalletView> {
    const db = this.database.db;
    const [wallet] = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.userId, userId), eq(wallets.unit, unit)));
    if (wallet)
      return {
        unit,
        balance: wallet.balance.toString(),
        state: wallet.state,
        exists: true,
        updatedAt: wallet.updatedAt.toISOString(),
      };
    // No operation yet: zero, restricted already if the account is.
    const [account] = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.userId, userId));
    return {
      unit,
      balance: "0",
      state: account && account.status !== "active" ? "restricted" : "active",
      exists: false,
      updatedAt: null,
    };
  }

  /**
   * Many players' balances in one read (the internal API): a player
   * without a wallet reads as zero, restricted already if the account is.
   */
  async balances(unit: WalletUnit, userIds: string[]): Promise<BalanceItem[]> {
    const db = this.database.db;
    const ids = [...new Set(userIds)];
    const rows = await db
      .select()
      .from(wallets)
      .where(and(eq(wallets.unit, unit), inArray(wallets.userId, ids)));
    const found = new Map(rows.map((row) => [row.userId, row]));
    const missing = ids.filter((id) => !found.has(id));
    const accounts = missing.length
      ? await db
          .select({ userId: users.userId, status: users.status })
          .from(users)
          .where(inArray(users.userId, missing))
      : [];
    const status = new Map(accounts.map((a) => [a.userId, a.status]));
    return userIds.map((userId) => {
      const row = found.get(userId);
      if (row)
        return {
          userId,
          unit,
          balance: row.balance.toString(),
          state: row.state,
          exists: true,
        };
      const account = status.get(userId);
      return {
        userId,
        unit,
        balance: "0",
        state: account && account !== "active" ? "restricted" : "active",
        exists: false,
      };
    });
  }

  async history(
    userId: string,
    query: { unit: WalletUnit; cursor?: string; limit: number },
  ) {
    const rows = await this.journal(userId, query);
    return { ...rows, items: rows.items.map(historyItem) };
  }

  /** One wallet's journal, newest first, optionally of one source; shared with the admin card. */
  async journal(
    userId: string,
    query: {
      unit: WalletUnit;
      source?: WalletSource;
      cursor?: string;
      limit: number;
    },
  ) {
    const before = decodeVersionCursor(query.cursor);
    const rows = await this.database.db
      .select()
      .from(walletTx)
      .where(
        and(
          eq(walletTx.userId, userId),
          eq(walletTx.unit, query.unit),
          query.source ? eq(walletTx.source, query.source) : undefined,
          before === null ? undefined : lt(walletTx.walletVersion, before),
        ),
      )
      .orderBy(desc(walletTx.walletVersion))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeVersionCursor(last.walletVersion)
          : null,
    };
  }
}
