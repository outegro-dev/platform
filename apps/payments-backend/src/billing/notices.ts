import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { createEvent, notificationRequested } from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import { and, eq } from "drizzle-orm";
import type {
  Executor,
  GrantRow,
  PaymentRow,
  RefundRow,
  SubscriptionRow,
} from "../common/database.js";
import { payWebConfig } from "../config/config.js";
import { grants, orders } from "../db/schema.js";
import { accessUntil, grantInForce } from "../domain/lifecycle.js";
import { type Currency, moneyDto } from "../domain/money.js";
import { neverGranted } from "./grants.js";

/** notifications-backend template per kind of confirmed payment. */
const receipts: Record<PaymentRow["kind"], string> = {
  purchase: "billing.payment-confirmed.v3",
  subscription_initial: "billing.subscription-started.v2",
  subscription_renewal: "billing.subscription-renewed.v2",
};

/**
 * The grant as the payment left it: in force, not in force yet, or
 * withheld: revoked (by an operator, or never granted as a duplicate), so
 * this payment will not open it and the operator refunds the payment.
 */
function accessOf(grant: GrantRow, at: Date) {
  if (grant.state === "revoked") return "withheld";
  return grantInForce(grant, at) ? "active" : "pending";
}

/**
 * Messages to the buyer, requested through the outbox in the transaction
 * of the fact they report (INV-13). Access is described exactly as the
 * grant stands in that transaction, never ahead of it; amounts go in minor
 * units and product titles in both languages, Notifications formats them.
 * A subscription whose grant was never given (a duplicate) gets no
 * renewal or expiry notices: they would read as the buyer's real one.
 */
@Injectable()
export class BillingNotices {
  constructor(
    @Inject(payWebConfig.KEY)
    private readonly payWeb: ConfigType<typeof payWebConfig>,
  ) {}

  /** Receipt of a confirmed payment, with the grant it activated. */
  async paymentConfirmed(
    tx: Executor,
    input: {
      payment: PaymentRow;
      grant: GrantRow;
      subscription: SubscriptionRow | null;
      sourceEventId: string;
    },
    at: Date,
    correlationId?: string,
  ) {
    const { payment, grant, subscription } = input;
    const access = accessOf(grant, at);
    await this.request(
      tx,
      {
        sourceEventId: input.sourceEventId,
        userId: payment.userId,
        templateKey: receipts[payment.kind],
        data: {
          ...(await this.product(tx, payment.orderId)),
          ...this.money(payment.amountMinor, payment.currency),
          paidAt: payment.paidAt.toISOString(),
          access,
          ...(subscription
            ? {
                paidUntil: subscription.paidUntil.toISOString(),
                actionUrl: this.link("/subscriptions"),
              }
            : {
                accessUntil:
                  access === "active"
                    ? (grant.validUntil?.toISOString() ?? null)
                    : null,
                actionUrl: this.link(`/orders/${payment.orderId}`),
              }),
        },
      },
      at,
      correlationId,
    );
  }

  /** The provider reported a failed renewal charge. */
  renewalFailed(
    tx: Executor,
    subscription: SubscriptionRow,
    sourceEventId: string,
    at: Date,
  ) {
    return this.aboutSubscription(
      tx,
      "billing.renewal-failed.v1",
      subscription,
      sourceEventId,
      at,
    );
  }

  /** The provider confirmed that renewal is off; paid time is kept. */
  subscriptionCancelled(
    tx: Executor,
    subscription: SubscriptionRow,
    sourceEventId: string,
    at: Date,
  ) {
    return this.aboutSubscription(
      tx,
      "billing.subscription-cancelled.v1",
      subscription,
      sourceEventId,
      at,
    );
  }

  /**
   * Paid time and grace are over. `endedAt` is when access from this
   * subscription really ended: a revoke or a refunded period ends it
   * before paidUntil + grace.
   */
  async subscriptionExpired(
    tx: Executor,
    subscription: SubscriptionRow,
    sourceEventId: string,
    at: Date,
  ) {
    const grant = await this.grantOf(tx, subscription);
    if (grant && neverGranted(grant)) return;
    await this.request(
      tx,
      {
        sourceEventId,
        userId: subscription.userId,
        templateKey: "billing.subscription-expired.v1",
        data: {
          ...(await this.product(tx, subscription.orderId)),
          endedAt: this.accessEnd(subscription, grant, at).toISOString(),
          actionUrl: this.link("/subscriptions"),
        },
      },
      at,
    );
  }

  /** A refund applied to its payment; `grant` is the payment's grant after it. */
  async refundRecorded(
    tx: Executor,
    input: { refund: RefundRow; payment: PaymentRow; grant: GrantRow | null },
    at: Date,
    correlationId?: string,
  ) {
    const { refund, payment, grant } = input;
    await this.request(
      tx,
      {
        // One message per refund, whichever event recorded it.
        sourceEventId: refund.id,
        userId: payment.userId,
        templateKey: "billing.refund-recorded.v1",
        data: {
          ...(await this.product(tx, payment.orderId)),
          ...this.money(
            refund.amountMinor ?? payment.amountMinor,
            payment.currency,
          ),
          accessUntil: this.inForceUntil(grant, at),
          actionUrl: this.link(`/orders/${payment.orderId}`),
        },
      },
      at,
      correlationId,
    );
  }

  private async aboutSubscription(
    tx: Executor,
    templateKey: string,
    subscription: SubscriptionRow,
    sourceEventId: string,
    at: Date,
  ) {
    const grant = await this.grantOf(tx, subscription);
    if (grant && neverGranted(grant)) return;
    await this.request(
      tx,
      {
        sourceEventId,
        userId: subscription.userId,
        templateKey,
        data: {
          ...(await this.product(tx, subscription.orderId)),
          accessUntil: this.inForceUntil(grant, at),
          actionUrl: this.link("/subscriptions"),
        },
      },
      at,
    );
  }

  private async grantOf(tx: Executor, subscription: SubscriptionRow) {
    const [grant] = await tx
      .select()
      .from(grants)
      .where(
        and(
          eq(grants.sourceType, "subscription"),
          eq(grants.sourceId, subscription.id),
          eq(grants.service, subscription.service),
          eq(grants.feature, subscription.feature),
        ),
      );
    return grant ?? null;
  }

  /** The end of a grant still in force; null when it gives no access now. */
  private inForceUntil(grant: GrantRow | null, at: Date) {
    return grant && grantInForce(grant, at)
      ? (grant.validUntil?.toISOString() ?? null)
      : null;
  }

  /**
   * When access from a subscription ended, by `at` at the latest: its
   * grant's end, earlier if it was revoked. Without a grant, the paid time
   * plus grace.
   */
  private accessEnd(
    subscription: SubscriptionRow,
    grant: GrantRow | null,
    at: Date,
  ) {
    if (!grant)
      return accessUntil(subscription.paidUntil, subscription.graceDays);
    const ends = [at, grant.validUntil, grant.revokedAt].filter(
      (end): end is Date => end !== null,
    );
    return new Date(Math.min(...ends.map((end) => end.getTime())));
  }

  private async product(tx: Executor, orderId: string) {
    const [order] = await tx
      .select({ title: orders.title })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) throw new Error("notice for a missing order");
    return { productEn: order.title.en, productRu: order.title.ru };
  }

  private money(minor: bigint, currency: Currency) {
    const dto = moneyDto(minor, currency);
    return {
      amountMinor: dto.minor,
      amountScale: dto.scale,
      currency: dto.currency,
    };
  }

  private link(path: string) {
    return new URL(path, this.payWeb.url).toString();
  }

  private async request(
    tx: Executor,
    input: {
      sourceEventId: string;
      userId: string;
      templateKey: string;
      data: Record<string, string | number | null>;
    },
    at: Date,
    correlationId?: string,
  ) {
    await enqueueEvent(
      tx,
      createEvent(notificationRequested, {
        producer: "payments",
        aggregateId: input.userId,
        aggregateVersion: 1,
        occurredAt: at,
        correlationId,
        payload: {
          sourceEventId: input.sourceEventId,
          templateKey: input.templateKey,
          category: "billing",
          recipient: { userId: input.userId },
          data: input.data,
        },
      }),
    );
  }
}
