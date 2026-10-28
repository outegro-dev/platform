import type { DatabaseHandle } from "@outegro/nest-common";
import type * as schema from "../db/schema.js";

export type WalletDatabase = DatabaseHandle<typeof schema>;
export type WalletDb = WalletDatabase["db"];
export type WalletTx = Parameters<Parameters<WalletDb["transaction"]>[0]>[0];
/** The database or an open transaction. */
export type Executor = WalletDb | WalletTx;

export type WalletRow = typeof schema.wallets.$inferSelect;
export type TxRow = typeof schema.walletTx.$inferSelect;
export type RefRow = typeof schema.walletRefs.$inferSelect;

/** PostgreSQL unique_violation, optionally for one constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}
