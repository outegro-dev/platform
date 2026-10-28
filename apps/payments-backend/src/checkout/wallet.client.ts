import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type { WalletSource } from "@outegro/contracts/wallet";
import { grumblePricesConfig } from "../config/config.js";

/** How a debit ended: done, refused for a reason, or not known. */
export type DebitResult =
  | { kind: "ok"; balanceAfter: bigint }
  | { kind: "insufficient_funds" }
  | { kind: "restricted" }
  | { kind: "rolled_back" }
  | { kind: "unknown"; why: string };

const TIMEOUT_MS = 5000;

/**
 * The wallet's internal API (docs/02-contracts/wallet.md) for purchases
 * with grumbles: a debit by the order's ref, its rollback, a balance.
 * A debit whose answer is lost is `unknown`: it may have gone through, so
 * the caller rolls the same ref back or repeats it, never a new one.
 */
@Injectable()
export class WalletClient {
  constructor(
    @Inject(grumblePricesConfig.KEY)
    private readonly config: ConfigType<typeof grumblePricesConfig>,
  ) {}

  get configured() {
    return Boolean(this.config.walletUrl && this.config.token);
  }

  async debit(input: {
    ref: string;
    userId: string;
    amount: bigint;
    source: WalletSource;
    objectRef: string;
    reason: string;
    meta: Record<string, unknown>;
    correlationId: string;
  }): Promise<DebitResult> {
    let response: Response;
    try {
      response = await this.post("/v1/internal/debit", {
        ...input,
        unit: "GRM",
        amount: input.amount.toString(),
      });
    } catch (error) {
      return { kind: "unknown", why: (error as Error).message };
    }
    if (response.ok) {
      const body = (await response.json()) as { balanceAfter: string };
      return { kind: "ok", balanceAfter: BigInt(body.balanceAfter) };
    }
    if (response.status === 402) return { kind: "insufficient_funds" };
    if (response.status === 423) return { kind: "restricted" };
    if (response.status === 409) {
      const body = (await response.json().catch(() => null)) as {
        error?: { fieldErrors?: { ref?: string[] } };
      } | null;
      if (body?.error?.fieldErrors?.ref?.includes("rolled_back"))
        return { kind: "rolled_back" };
    }
    return { kind: "unknown", why: `wallet answered ${response.status}` };
  }

  /** Undoes the debit of `ref` (or leaves a tombstone); true once settled. */
  async rollback(ref: string, reason: string, correlationId: string) {
    try {
      const response = await this.post("/v1/internal/rollback", {
        ref,
        reason,
        correlationId,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** The player's grumbles; null when the wallet does not answer. */
  async balance(userId: string): Promise<bigint | null> {
    try {
      const response = await this.post("/v1/internal/balances", {
        unit: "GRM",
        userIds: [userId],
      });
      if (!response.ok) return null;
      const body = (await response.json()) as {
        items: { balance: string }[];
      };
      const [item] = body.items;
      return item ? BigInt(item.balance) : null;
    } catch {
      return null;
    }
  }

  private post(path: string, body: unknown) {
    const { walletUrl, token } = this.config;
    if (!walletUrl || !token) throw new Error("wallet is not configured");
    return fetch(new URL(path, walletUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
