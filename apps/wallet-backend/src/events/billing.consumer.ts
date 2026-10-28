import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  type AnyEvent,
  billingGrumblesPurchased,
  billingGrumblesReversed,
  defineQueue,
  type Money,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import { DATABASE, Messaging, PermanentError } from "@outegro/nest-common";
import type { WalletDatabase, WalletTx } from "../common/database.js";
import { WalletLedger } from "../ledger/ledger.js";

export const billingQueue = defineQueue("wallet", "billing-events", [
  {
    producer: "payments",
    types: [billingGrumblesPurchased.type, billingGrumblesReversed.type],
  },
]);

const money = (value: Money) => ({
  minor: BigInt(value.minor),
  currency: value.currency,
  scale: value.scale,
});

/**
 * Packs of grumbles from Payments (phase 2): a paid pack is credited, a
 * refunded or charged-back one taken back. The inbox marker and the
 * operation commit together; the pack's payment and the payments' case
 * are the second barrier, so a repeat changes nothing.
 */
@Injectable()
export class BillingConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: WalletDatabase,
    private readonly ledger: WalletLedger,
    private readonly messaging: Messaging,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(billingQueue, async (event) => {
      await this.apply(event);
    });
  }

  /** True when the event changed a wallet. */
  async apply(event: AnyEvent): Promise<boolean> {
    let applied = false;
    await processOnce(
      this.database.db,
      { consumer: billingQueue.name, eventId: event.eventId, type: event.type },
      async (anyTx) => {
        // processOnce runs it in a transaction of this service's database.
        const tx = anyTx as WalletTx;
        applied = await this.applyIn(tx, event);
      },
    );
    return applied;
  }

  private applyIn(tx: WalletTx, event: AnyEvent): Promise<boolean> {
    switch (event.type) {
      case billingGrumblesPurchased.type: {
        const parsed = billingGrumblesPurchased.schema.safeParse(event);
        if (!parsed.success)
          throw new PermanentError(
            "invalid billing.grumbles-purchased payload",
          );
        const pack = parsed.data.payload;
        return this.ledger.purchase(tx, {
          paymentId: pack.paymentId,
          orderId: pack.orderId,
          userId: pack.userId,
          unit: "GRM",
          productKey: pack.productKey,
          grumbles: BigInt(pack.grumbles),
          money: money(pack.money),
          paidAt: new Date(pack.paidAt),
          correlationId: parsed.data.correlationId ?? null,
        });
      }
      case billingGrumblesReversed.type: {
        const parsed = billingGrumblesReversed.schema.safeParse(event);
        if (!parsed.success)
          throw new PermanentError("invalid billing.grumbles-reversed payload");
        const reversal = parsed.data.payload;
        return this.ledger.clawback(tx, {
          caseId: reversal.caseId,
          paymentId: reversal.paymentId,
          userId: reversal.userId,
          unit: "GRM",
          kind: reversal.kind,
          grumbles: BigInt(reversal.grumbles),
          money: money(reversal.money),
          occurredAt: new Date(reversal.occurredAt),
          correlationId: parsed.data.correlationId ?? null,
        });
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
