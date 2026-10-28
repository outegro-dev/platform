import {
  type AdminOverview,
  type AdminTx,
  type AdminWallet,
  adminCommandSchema,
  adminOverviewSchema,
  adminWalletCardSchema,
  adminWalletsPageSchema,
  type Operation,
  operationSchema,
  type ReconciliationIssue,
  type ReconciliationRun,
  reconciliationIssueKinds,
  reconciliationViewSchema,
  setBalanceCommandSchema,
  systemAccountCodes,
  txKinds,
  type WalletSource,
  walletSources,
  walletStates,
} from "@outegro/contracts/wallet";
import type { Page } from "../result";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * wallet-backend admin API (grumbles; contract `@outegro/contracts/wallet`,
 * docs/02-contracts/wallet.md): the only file that knows its paths and
 * response shapes. Every call carries the operator's own token.
 *
 *   GET  /v1/admin/overview                         wallet.read
 *   GET  /v1/admin/wallets?state&userId&cursor      wallet.read, newest change first
 *   GET  /v1/admin/wallets/:userId?source&cursor    wallet and its journal; no wallet: zero
 *   POST /v1/admin/wallets/:userId/grant  {unit, amount, reason, commandId}   wallet.adjust
 *   POST /v1/admin/wallets/:userId/adjust {unit, amount, reason, commandId}   wallet.adjust
 *   POST /v1/admin/wallets/:userId/set-balance {unit, balance, reason, commandId}   wallet.adjust
 *   GET  /v1/admin/reconciliation                   open and recent issues, last passes
 *
 * Refusals: 402 INSUFFICIENT_FUNDS (taking more than the balance), 400 with
 * `amount: too_large` (over the per-command cap), 409 IDEMPOTENCY_CONFLICT
 * (the form's commandId was used with other data), 422 `balance: unchanged`
 * (setting the balance it already has), 403, 401 (stale token).
 */

export type { WalletSource };
export {
  reconciliationIssueKinds,
  systemAccountCodes,
  txKinds,
  walletSources,
  walletStates,
};
export type WalletOverview = AdminOverview;
export type WalletView = AdminWallet;
export type WalletTx = AdminTx;
export type WalletCard = { wallet: WalletView; history: Page<WalletTx> };
export type WalletIssue = ReconciliationIssue;
export type WalletRun = ReconciliationRun;
export type WalletState = (typeof walletStates)[number];

export type WalletFilter = {
  state?: WalletState;
  userId?: string;
  cursor?: string;
  limit?: number;
};

/** One unit for now; the contract keeps the field for later ones. */
const UNIT = "GRM";

/**
 * The per-command cap wallet-backend applies by default
 * (`WALLET_ADMIN_MAX_AMOUNT`); the form shows it, the service enforces its own.
 */
export const ADMIN_MAX_AMOUNT = "1000000";

const userPath = (userId: string) =>
  `/v1/admin/wallets/${encodeURIComponent(userId)}`;

export class WalletAdmin extends OptionalServiceAdapter {
  async overview(): Promise<WalletOverview> {
    return parse(
      adminOverviewSchema,
      await this.get("/v1/admin/overview", { unit: UNIT }, { list: true }),
      "wallet overview",
    );
  }

  async wallets(filter: WalletFilter): Promise<Page<WalletView>> {
    return parse(
      adminWalletsPageSchema,
      await this.get(
        "/v1/admin/wallets",
        { unit: UNIT, ...filter },
        { list: true },
      ),
      "wallets",
    );
  }

  /** A wallet and a page of its journal; a user without one gets zero. */
  async wallet(
    userId: string,
    page: { cursor?: string; source?: WalletSource; limit?: number } = {},
  ): Promise<WalletCard> {
    return parse(
      adminWalletCardSchema,
      await this.get(userPath(userId), { unit: UNIT, ...page }),
      "wallet",
    );
  }

  /** Grant (`grant`) or take (`adjust`) grumbles; one commandId per opened form. */
  async command(
    kind: "grant" | "adjust",
    userId: string,
    input: { amount: string; reason: string; commandId: string },
  ): Promise<Operation> {
    const body = adminCommandSchema.parse({ unit: UNIT, ...input });
    return parse(
      operationSchema,
      await this.send("POST", `${userPath(userId)}/${kind}`, body),
      "wallet command",
    );
  }

  /** Set the balance: the wallet grants or takes the difference. */
  async setBalance(
    userId: string,
    input: { balance: string; reason: string; commandId: string },
  ): Promise<Operation> {
    const body = setBalanceCommandSchema.parse({ unit: UNIT, ...input });
    return parse(
      operationSchema,
      await this.send("POST", `${userPath(userId)}/set-balance`, body),
      "wallet set balance",
    );
  }

  async reconciliation(): Promise<{
    issues: WalletIssue[];
    runs: WalletRun[];
  }> {
    return parse(
      reconciliationViewSchema,
      await this.get("/v1/admin/reconciliation", undefined, { list: true }),
      "wallet reconciliation",
    );
  }
}
