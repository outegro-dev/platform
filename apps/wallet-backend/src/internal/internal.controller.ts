import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import {
  type CreditBatchRequest,
  creditBatchRequestSchema,
  type DebitRequest,
  debitRequestSchema,
  type RollbackRequest,
  rollbackRequestSchema,
} from "@outegro/contracts/wallet";
import { createServiceTokenGuard, Public } from "@outegro/nest-common";
import { env } from "../config/env.js";
import { WalletLedger } from "../ledger/ledger.js";

const ServiceToken = createServiceTokenGuard(() => env().INTERNAL_API_TOKEN);

/** The largest body: a full credit batch, every item with 2 KB of meta. */
export const JSON_LIMIT = "3mb";

/**
 * The internal API (docs/02-contracts/wallet.md) for payments (purchases)
 * and roulette-backend (stakes, payouts, cancelled rounds). Inside the
 * cluster only, behind the shared service token; every call is idempotent
 * by its ref. Not rate-limited: all calls come from a few pods, and a
 * per-address limit would throttle a whole service.
 */
@Public()
@SkipThrottle()
@UseGuards(ServiceToken)
@Controller("internal")
export class InternalController {
  constructor(private readonly ledger: WalletLedger) {}

  @Post("debit")
  @HttpCode(200)
  debit(@Body({ schema: debitRequestSchema }) body: DebitRequest) {
    return this.ledger.debit({ ...body, amount: BigInt(body.amount) });
  }

  @Post("credit-batch")
  @HttpCode(200)
  async creditBatch(
    @Body({ schema: creditBatchRequestSchema }) body: CreditBatchRequest,
  ) {
    const items = await this.ledger.creditBatch(
      body.unit,
      body.items,
      body.correlationId ?? null,
    );
    return { items };
  }

  @Post("rollback")
  @HttpCode(200)
  rollback(@Body({ schema: rollbackRequestSchema }) body: RollbackRequest) {
    return this.ledger.rollback(body);
  }
}
