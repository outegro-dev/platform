import { z } from "zod";
import type { Page } from "../result";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * payments-backend (Lava) admin API: the only file that knows its paths and
 * shapes. Reads need `billing.read`; commands need their own permission, a
 * reason and a fresh token (a stale one gets 401 and is refreshed once).
 *
 *   GET  /v1/catalog                               public: products, prices, sales open
 *   GET  /v1/admin/orders?status&userId&productKey&from&to&cursor&limit
 *   GET  /v1/admin/orders/:id                      attempt, payments, subscription, grants, events, audit
 *   GET  /v1/admin/payments?userId&orderId&state&currency&cursor&limit
 *   GET  /v1/admin/subscriptions?userId&state&productKey&cursor&limit
 *   GET  /v1/admin/provider-events?status&type&contractId&orderId&cursor&limit
 *   GET  /v1/admin/provider-events/:id             with the raw payload
 *   GET  /v1/admin/issues?status&kind&cursor&limit reconciliation
 *   GET  /v1/admin/grants?userId&state&sourceType&cursor&limit
 *   GET  /v1/admin/refunds?state&kind&cursor&limit
 *   GET  /v1/admin/stats?from&to                   revenue per currency, subscriptions, conversion
 *   GET  /v1/admin/audit?cursor&limit              assumed (not in the API yet)
 *   POST /v1/admin/grants {userId, service, feature, validUntil?, reason}   grants.assign
 *   POST /v1/admin/grants/:id/revoke {reason}                               grants.assign
 *   POST /v1/admin/subscriptions/:id/cancel {reason}                        subscriptions.cancel
 *   POST /v1/admin/payments/:id/refund-request {reason}                     refunds.request
 *   POST /v1/admin/refunds/:id/match {paymentId, reason}                    refunds.request
 */

export const orderStatuses = ["pending", "paid", "failed", "refunded"] as const;
export const subscriptionStates = [
  "pending",
  "active",
  "past_due",
  "cancel_requested",
  "cancelling",
  "expired",
  "suspended",
] as const;
export const eventStatuses = [
  "received",
  "processed",
  "ignored",
  "unmatched",
  "mismatch",
  "quarantined",
  "invalid",
  "failed",
] as const;
export const grantStates = ["active", "revoked", "expired"] as const;
export const grantSources = ["purchase", "subscription", "manual"] as const;
export const refundStates = [
  "requested",
  "unmatched",
  "review_required",
  "recorded",
  "open",
] as const;
export const refundKinds = ["refund", "chargeback"] as const;
export const paymentStates = ["confirmed", "refunded", "disputed"] as const;
/** What reconciliation issues are about (`labels.issueKind`). */
export const issueKinds = [
  "amount_mismatch",
  "renewal_without_parent",
  "unmatched_event",
  "event_failed",
  "checkout_unknown",
  "invoice_missing",
  "cancel_failed",
  "renewal_cancel_failed",
  "period_mismatch",
  "refund_unmatched",
  "refund_review",
  "chargeback_opened",
  "duplicate_purchase",
  "renewal_after_revoke",
] as const;
/** Subscriptions an operator can still stop (the provider may charge again). */
export const cancellableStates = ["active", "past_due"] as const;

/**
 * Stop renewal is offered while Lava may still charge: an active or past
 * due subscription, or one whose cancel Lava has not confirmed yet (the
 * command sends it again).
 */
export const canStopRenewal = (subscription: {
  state: string;
  autoRenew: boolean;
}) =>
  (cancellableStates as readonly string[]).includes(subscription.state) ||
  (subscription.state === "cancel_requested" && subscription.autoRenew);

const money = z.object({
  minor: z.string().regex(/^-?\d+$/),
  currency: z.string(),
  scale: z.number().int().min(0).max(4),
});
const text = z.object({ en: z.string(), ru: z.string() });
const iso = z.string();

const grantSchema = z.object({
  id: z.string(),
  userId: z.string(),
  service: z.string(),
  feature: z.string(),
  sourceType: z.string(),
  sourceId: z.string(),
  state: z.string(),
  validFrom: iso,
  validUntil: iso.nullable(),
  version: z.number().int().optional(),
});
const adminGrantSchema = grantSchema.extend({
  reason: z.string().nullable().optional(),
  grantedBy: z.string().nullable().optional(),
  revokedAt: iso.nullable().optional(),
  revokedBy: z.string().nullable().optional(),
  revokeReason: z.string().nullable().optional(),
});

const orderSchema = z.object({
  id: z.string(),
  userId: z.string().optional(),
  productKey: z.string(),
  title: text,
  kind: z.string(),
  status: z.string(),
  money,
  priceVersion: z.number().int(),
  createdAt: iso,
  paidAt: iso.nullable(),
  checkout: z
    .object({ state: z.string(), paymentUrl: z.string().nullable() })
    .nullable(),
  subscriptionId: z.string().nullable(),
  access: grantSchema.nullable(),
});

const subscriptionSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  productKey: z.string(),
  title: text.nullable(),
  state: z.string(),
  autoRenew: z.boolean(),
  paidUntil: iso,
  accessUntil: iso,
  money,
  periodicity: z.string(),
  cancelRequestedAt: iso.nullable(),
  cancelledAt: iso.nullable(),
  expiredAt: iso.nullable(),
  createdAt: iso,
  userId: z.string().optional(),
  providerStatus: z.string().nullable().optional(),
});

const paymentSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  subscriptionId: z.string().nullable(),
  userId: z.string(),
  kind: z.string(),
  state: z.string(),
  money,
  providerContractId: z.string().nullable(),
  paidAt: iso,
  confirmedAt: iso,
});

const eventSchema = z.object({
  id: z.string(),
  source: z.string(),
  type: z.string(),
  rawType: z.string().nullable(),
  status: z.string(),
  note: z.string().nullable(),
  contractId: z.string().nullable(),
  parentContractId: z.string().nullable(),
  orderId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  paymentId: z.string().nullable(),
  refundId: z.string().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  payloadHash: z.string(),
  receivedAt: iso,
  processedAt: iso.nullable(),
  payload: z.unknown().optional(),
  fact: z.unknown().optional(),
});

const refundSchema = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.string(),
  providerRef: z.string().nullable(),
  paymentId: z.string().nullable(),
  userId: z.string().nullable(),
  refundType: z.string().nullable(),
  money: money.nullable(),
  reason: z.string().nullable(),
  evidence: z.unknown(),
  requestedBy: z.string().nullable(),
  createdAt: iso,
  updatedAt: iso,
});

const issueSchema = z.object({
  id: z.string(),
  kind: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  status: z.enum(["open", "resolved"]),
  subjectKey: z.string(),
  related: z.unknown(),
  evidence: z.unknown(),
  occurrences: z.number().int(),
  firstSeenAt: iso,
  lastSeenAt: iso,
  resolvedAt: iso.nullable(),
  resolution: z.string().nullable(),
});

const auditSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  data: z.unknown(),
  createdAt: iso,
});

const orderDetailSchema = z.object({
  order: orderSchema.extend({
    userId: z.string(),
    correlationId: z.string().nullable().optional(),
  }),
  attempt: z
    .object({
      id: z.string(),
      state: z.string(),
      providerInvoiceId: z.string().nullable(),
      failureReason: z.string().nullable(),
      checks: z.number().int(),
      nextCheckAt: iso.nullable(),
      requestedAt: iso,
      resolvedAt: iso.nullable(),
    })
    .nullable(),
  payments: z.array(paymentSchema),
  subscription: subscriptionSchema.nullable(),
  grants: z.array(grantSchema),
  refunds: z.array(refundSchema),
  events: z.array(eventSchema),
  audit: z.array(auditSchema),
});

const nullableMoney = money.nullable();
const statsSchema = z.object({
  from: iso,
  to: iso,
  revenue: z.object({
    byDay: z.array(
      z.object({
        day: z.string(),
        currency: z.string(),
        gross: nullableMoney,
        refunded: nullableMoney,
        net: nullableMoney,
        payments: z.number().int(),
      }),
    ),
    totals: z.array(
      z.object({
        currency: z.string(),
        gross: nullableMoney,
        refunded: nullableMoney,
        net: nullableMoney,
        payments: z.number().int(),
      }),
    ),
  }),
  activeSubscriptions: z.object({
    total: z.number().int(),
    byProduct: z.array(
      z.object({ productKey: z.string(), count: z.number().int() }),
    ),
  }),
  conversion: z.array(
    z.object({
      productKey: z.string(),
      checkouts: z.number().int(),
      paid: z.number().int(),
      failed: z.number().int(),
      pending: z.number().int(),
    }),
  ),
});

const catalogSchema = z.object({
  checkoutEnabled: z.boolean(),
  products: z.array(
    z.object({
      key: z.string(),
      service: z.string(),
      feature: z.string(),
      kind: z.string(),
      periodicity: z.string(),
      graceDays: z.number().int(),
      title: text,
      description: text,
      prices: z.array(
        z.object({
          priceId: z.string(),
          version: z.number().int(),
          money,
        }),
      ),
    }),
  ),
});

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export type LocalizedText = z.infer<typeof text>;
export type Order = z.infer<typeof orderSchema>;
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type Payment = z.infer<typeof paymentSchema>;
export type ProviderEvent = z.infer<typeof eventSchema>;
export type Refund = z.infer<typeof refundSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type PaymentGrant = z.infer<typeof adminGrantSchema>;
export type PaymentsStats = z.infer<typeof statsSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type Product = Catalog["products"][number];
export type PaymentsAuditEntry = z.infer<typeof auditSchema>;

type Paged = { cursor?: string; limit?: number };
export type OrderFilter = Paged & {
  status?: string;
  userId?: string;
  productKey?: string;
  from?: string;
  to?: string;
};

export class PaymentsAdmin extends OptionalServiceAdapter {
  async catalog(): Promise<Catalog> {
    return parse(
      catalogSchema,
      await this.get("/v1/catalog", undefined, { list: true }),
      "payments catalog",
    );
  }

  async orders(filter: OrderFilter): Promise<Page<Order>> {
    return parse(
      page(orderSchema),
      await this.get("/v1/admin/orders", filter, { list: true }),
      "payments orders",
    );
  }

  async order(id: string): Promise<OrderDetail> {
    return parse(
      orderDetailSchema,
      await this.get(`/v1/admin/orders/${encodeURIComponent(id)}`),
      "payments order",
    );
  }

  async payments(
    filter: Paged & {
      userId?: string;
      orderId?: string;
      state?: string;
      currency?: string;
    },
  ): Promise<Page<Payment>> {
    return parse(
      page(paymentSchema),
      await this.get("/v1/admin/payments", filter, { list: true }),
      "payments list",
    );
  }

  async subscriptions(
    filter: Paged & { userId?: string; state?: string; productKey?: string },
  ): Promise<Page<Subscription>> {
    return parse(
      page(subscriptionSchema),
      await this.get("/v1/admin/subscriptions", filter, { list: true }),
      "payments subscriptions",
    );
  }

  async events(
    filter: Paged & {
      status?: string;
      type?: string;
      contractId?: string;
      orderId?: string;
    },
  ): Promise<Page<ProviderEvent>> {
    return parse(
      page(eventSchema),
      await this.get("/v1/admin/provider-events", filter, { list: true }),
      "payments events",
    );
  }

  async event(id: string): Promise<ProviderEvent> {
    return parse(
      eventSchema,
      await this.get(`/v1/admin/provider-events/${encodeURIComponent(id)}`),
      "payments event",
    );
  }

  async issues(
    filter: Paged & { status?: "open" | "resolved"; kind?: string },
  ): Promise<Page<Issue>> {
    return parse(
      page(issueSchema),
      await this.get("/v1/admin/issues", filter, { list: true }),
      "payments issues",
    );
  }

  async grants(
    filter: Paged & { userId?: string; state?: string; sourceType?: string },
  ): Promise<Page<PaymentGrant>> {
    return parse(
      page(adminGrantSchema),
      await this.get("/v1/admin/grants", filter, { list: true }),
      "payments grants",
    );
  }

  async refunds(
    filter: Paged & { state?: string; kind?: string },
  ): Promise<Page<Refund>> {
    return parse(
      page(refundSchema),
      await this.get("/v1/admin/refunds", filter, { list: true }),
      "payments refunds",
    );
  }

  async stats(range: { from?: string; to?: string }): Promise<PaymentsStats> {
    return parse(
      statsSchema,
      await this.get("/v1/admin/stats", range, { list: true }),
      "payments stats",
    );
  }

  /** Assumed endpoint in the shape of the other services' audit feeds. */
  async audit(filter: Paged): Promise<Page<PaymentsAuditEntry>> {
    return parse(
      page(auditSchema),
      await this.get("/v1/admin/audit", filter, { list: true }),
      "payments audit",
    );
  }

  async grant(input: {
    userId: string;
    service: string;
    feature: string;
    validUntil: string | null;
    reason: string;
  }): Promise<void> {
    await this.send("POST", "/v1/admin/grants", {
      userId: input.userId,
      service: input.service,
      feature: input.feature,
      ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      reason: input.reason,
    });
  }

  async revokeGrant(id: string, reason: string): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/grants/${encodeURIComponent(id)}/revoke`,
      { reason },
    );
  }

  async cancelSubscription(id: string, reason: string): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/subscriptions/${encodeURIComponent(id)}/cancel`,
      { reason },
    );
  }

  async requestRefund(paymentId: string, reason: string): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/payments/${encodeURIComponent(paymentId)}/refund-request`,
      { reason },
    );
  }

  async matchRefund(
    refundId: string,
    paymentId: string,
    reason: string,
  ): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/refunds/${encodeURIComponent(refundId)}/match`,
      { paymentId, reason },
    );
  }
}
