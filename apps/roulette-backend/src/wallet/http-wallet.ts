import { z } from "zod";
import {
  type CreditItem,
  type CreditResult,
  type DebitInput,
  WALLET_SOURCE,
  WALLET_UNIT,
  WalletError,
  type WalletPort,
} from "./wallet.port.js";

/** Amounts travel as integer strings; older answers may carry numbers. */
const amount = z
  .union([z.string().regex(/^-?\d+$/), z.number().int()])
  .transform(Number);

const operationSchema = z.object({
  ref: z.string(),
  balanceAfter: amount,
  replayed: z.boolean().default(false),
});
const creditBatchSchema = z.object({ items: z.array(operationSchema) });
const rollbackSchema = z.object({
  state: z.enum(["reversed", "tombstoned"]),
});
const balancesSchema = z.object({
  items: z.array(z.object({ userId: z.string(), balance: amount })),
});
/** The most ids one balances call takes. */
const BALANCES_LIMIT = 1000;

/**
 * wallet-backend over its internal API (`/v1/internal/*`, ADR-011) and the
 * shared service token. Refusals map to the port's codes: 402 no funds,
 * 423 restricted, 409 conflict or rolled back; anything else, a timeout
 * included, is "unavailable": the operation may or may not have happened.
 */
export class HttpWallet implements WalletPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 3000,
  ) {}

  async debit(input: DebitInput): Promise<{ balance: number }> {
    const operation = operationSchema.parse(
      await this.call("/v1/internal/debit", {
        ref: input.ref,
        userId: input.userId,
        unit: WALLET_UNIT,
        amount: String(input.amount),
        source: WALLET_SOURCE,
        objectRef: input.objectRef,
        meta: input.meta,
      }),
    );
    return { balance: operation.balanceAfter };
  }

  async creditBatch(items: CreditItem[]): Promise<CreditResult[]> {
    if (items.length === 0) return [];
    const { items: operations } = creditBatchSchema.parse(
      await this.call("/v1/internal/credit-batch", {
        unit: WALLET_UNIT,
        source: WALLET_SOURCE,
        items: items.map((item) => ({
          ref: item.ref,
          userId: item.userId,
          amount: String(item.amount),
          objectRef: item.objectRef,
          meta: item.meta,
        })),
      }),
    );
    return operations.map((operation) => ({
      ref: operation.ref,
      balance: operation.balanceAfter,
      replayed: operation.replayed,
    }));
  }

  async rollback(ref: string): Promise<{ status: "reversed" | "tombstoned" }> {
    const { state } = rollbackSchema.parse(
      await this.call("/v1/internal/rollback", { ref }),
    );
    return { status: state };
  }

  async balances(userIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const unique = [...new Set(userIds)];
    for (let i = 0; i < unique.length; i += BALANCES_LIMIT) {
      const { items } = balancesSchema.parse(
        await this.call("/v1/internal/balances", {
          unit: WALLET_UNIT,
          userIds: unique.slice(i, i + BALANCES_LIMIT),
        }),
      );
      for (const item of items) result.set(item.userId, item.balance);
    }
    return result;
  }

  private async call(path: string, body: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(new URL(path, this.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new WalletError("unavailable");
    }
    if (response.ok) return response.json();
    if (response.status === 402) throw new WalletError("insufficient_funds");
    if (response.status === 423) throw new WalletError("restricted");
    if (response.status === 409) throw new WalletError("conflict");
    throw new WalletError("unavailable");
  }
}
