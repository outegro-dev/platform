import { Inject, Injectable } from "@nestjs/common";
import type {
  HistoryItem,
  WalletUnit,
  WalletView,
} from "@outegro/contracts/wallet";
import { DATABASE } from "@outegro/nest-common";
import { and, desc, eq, lt } from "drizzle-orm";
import type { TxRow, WalletDatabase } from "../common/database.js";
import { decodeVersionCursor, encodeVersionCursor } from "../common/pages.js";
import { users, wallets, walletTx } from "../db/schema.js";

export const historyItem = (row: TxRow): HistoryItem => ({
  id: row.id,
  kind: row.kind,
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

  async history(
    userId: string,
    query: { unit: WalletUnit; cursor?: string; limit: number },
  ) {
    const rows = await this.journal(userId, query);
    return { ...rows, items: rows.items.map(historyItem) };
  }

  /** One wallet's journal, newest first; shared with the admin card. */
  async journal(
    userId: string,
    query: { unit: WalletUnit; cursor?: string; limit: number },
  ) {
    const before = decodeVersionCursor(query.cursor);
    const rows = await this.database.db
      .select()
      .from(walletTx)
      .where(
        and(
          eq(walletTx.userId, userId),
          eq(walletTx.unit, query.unit),
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
