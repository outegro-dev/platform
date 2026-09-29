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

/** notifications-backend template per kind of confirmed payment. */
const receipts: Record<PaymentRow["kind"], string> = {
  purchase: "billing.payment-confirmed.v2",
  subscription_initial: "billing.subscription-started.v1",
  subscription_renewal: "billing.subscription-renewed.v1",
};

/**
 * Messages to the buyer, requested through the outbox in the transaction
 * of the fact they report (INV-13). Access is described exactly as the
 * grant stands in that transaction, never ahead of it; amounts go in minor
 * units and product titles in both languages, Notifications formats them.
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
    const active = grantInForce(grant, at);
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
          access: active ? "active" : "pending",
          ...(subscription
            ? {
                paidUntil: subscription.paidUntil.toISOString(),
                actionUrl: this.link("/subscriptions"),
              }
            : {
                accessUntil: active
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

  /** Paid time and grace are over. */
  async subscriptionExpired(
    tx: Executor,
    subscription: SubscriptionRow,
    sourceEventId: string,
    at: Date,
  ) {
    await this.request(
      tx,
      {
        sourceEventId,
        userId: subscription.userId,
        templateKey: "billing.subscription-expired.v1",
        data: {
          ...(await this.product(tx, subscription.orderId)),
          endedAt: accessUntil(
            subscription.paidUntil,
            subscription.graceDays,
          ).toISOString(),
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
    await this.request(
      tx,
      {
        sourceEventId,
        userId: subscription.userId,
        templateKey,
        data: {
          ...(await this.product(tx, subscription.orderId)),
          accessUntil: this.inForceUntil(grant ?? null, at),
          actionUrl: this.link("/subscriptions"),
        },
      },
      at,
    );
  }

  /** The end of a grant still in force; null when it gives no access now. */
  private inForceUntil(grant: GrantRow | null, at: Date) {
    return grant && grantInForce(grant, at)
      ? (grant.validUntil?.toISOString() ?? null)
      : null;
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
