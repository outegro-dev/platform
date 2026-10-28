import { Logger } from "@nestjs/common";
import { z } from "zod";

/** One bonus credit: `ref = daily:{userId}:{claimNo}`, unique in the wallet. */
export type BonusCredit = {
  userId: string;
  amount: number;
  ref: string;
  objectRef: string;
  meta: { streak: number; basePrize: number };
};

/**
 * The grumbles wallet as the bonus sees it: one credit with the source
 * `daily-bonus` (the wallet books it against `issued_bonus`). A repeat of
 * the same ref returns the first answer, so a retry never pays twice.
 */
export interface DailyWalletPort {
  credit(item: BonusCredit): Promise<{ balance: number }>;
}

export class WalletUnavailable extends Error {
  constructor(readonly status: number | null) {
    super(`wallet unavailable (${status ?? "no answer"})`);
  }
}

const amount = z
  .union([z.string().regex(/^-?\d+$/), z.number().int()])
  .transform(Number);
const creditBatchSchema = z.object({
  items: z.array(z.object({ ref: z.string(), balanceAfter: amount })).min(1),
});

/** wallet-backend's `POST /v1/internal/credit-batch` with one line. */
export class HttpDailyWallet implements DailyWalletPort {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly timeoutMs = 3000,
  ) {}

  async credit(item: BonusCredit): Promise<{ balance: number }> {
    let response: Response;
    try {
      response = await fetch(
        new URL("/v1/internal/credit-batch", this.baseUrl),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            unit: "GRM",
            source: "daily-bonus",
            items: [
              {
                ref: item.ref,
                userId: item.userId,
                amount: String(item.amount),
                objectRef: item.objectRef,
                meta: item.meta,
              },
            ],
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch {
      throw new WalletUnavailable(null);
    }
    if (!response.ok) throw new WalletUnavailable(response.status);
    const [line] = creditBatchSchema.parse(await response.json()).items;
    return { balance: line?.balanceAfter ?? 0 };
  }
}

/** The wallet in process memory: tests and local runs without wallet-backend. */
export class InMemoryDailyWallet implements DailyWalletPort {
  private readonly logger = new Logger("InMemoryDailyWallet");
  private readonly balances = new Map<string, number>();
  private readonly credits = new Map<string, number>();
  readonly calls: BonusCredit[] = [];
  /** Tests: the next call fails as if the wallet were down. */
  failNext = 0;

  constructor(private readonly openingBalance: number) {
    this.logger.warn("Bonus credits stay in process memory (development)");
  }

  async credit(item: BonusCredit): Promise<{ balance: number }> {
    this.calls.push(item);
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new WalletUnavailable(503);
    }
    const replay = this.credits.get(item.ref);
    if (replay !== undefined) return { balance: replay };
    const balance =
      (this.balances.get(item.userId) ?? this.openingBalance) + item.amount;
    this.balances.set(item.userId, balance);
    this.credits.set(item.ref, balance);
    return { balance };
  }

  balanceOf(userId: string): number {
    return this.balances.get(userId) ?? this.openingBalance;
  }
}
