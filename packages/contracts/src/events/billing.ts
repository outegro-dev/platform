import { z } from "zod";
import { defineEvent } from "../envelope.js";
import { isoDateTime, moneySchema } from "../primitives.js";

export const billingGrantChanged = defineEvent(
  "billing.grant.changed.v1",
  "payments",
  z.object({
    grantId: z.uuid(),
    userId: z.uuid(),
    service: z.string().min(1),
    feature: z.string().min(1),
    sourceType: z.enum(["purchase", "subscription", "manual"]),
    sourceId: z.uuid(),
    state: z.enum(["active", "revoked", "expired"]),
    validFrom: isoDateTime,
    /** null only for an explicitly perpetual grant; never "unknown". */
    validUntil: isoDateTime.nullable(),
  }),
);

export const billingPaymentConfirmed = defineEvent(
  "billing.payment.confirmed.v1",
  "payments",
  z.object({
    paymentId: z.uuid(),
    orderId: z.uuid(),
    userId: z.uuid(),
    money: moneySchema,
    confirmedAt: isoDateTime,
  }),
);

export const billingSubscriptionChanged = defineEvent(
  "billing.subscription.changed.v1",
  "payments",
  z.object({
    subscriptionId: z.uuid(),
    userId: z.uuid(),
    state: z.enum([
      "pending",
      "active",
      "past_due",
      "cancel_requested",
      "cancelling",
      "expired",
      "suspended",
    ]),
    paidUntil: isoDateTime.nullable(),
    autoRenew: z.boolean(),
  }),
);
