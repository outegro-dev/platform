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

/** A pack's grumbles: a whole number from 1 to 10^15-1, as a string. */
const grumblesSchema = z.string().regex(/^[1-9]\d{0,14}$/);

/**
 * A pack of grumbles paid for (phase 2, ADR-011). Settled instead of a
 * grant; the wallet credits it exactly once, by `pack:payment:{paymentId}`.
 */
export const billingGrumblesPurchased = defineEvent(
  "billing.grumbles-purchased.v1",
  "payments",
  z.object({
    paymentId: z.uuid(),
    orderId: z.uuid(),
    userId: z.uuid(),
    productKey: z.string().min(1),
    grumbles: grumblesSchema,
    /** What the buyer paid for the pack. */
    money: moneySchema,
    paidAt: isoDateTime,
  }),
);

/**
 * Money of a pack given back: a refund (all of it or a part) or a
 * chargeback. The wallet takes back `grumbles` once per case
 * (`pack:case:{caseId}`); what the wallet no longer holds becomes a debt
 * and restricts it.
 */
export const billingGrumblesReversed = defineEvent(
  "billing.grumbles-reversed.v1",
  "payments",
  z.object({
    caseId: z.uuid(),
    paymentId: z.uuid(),
    userId: z.uuid(),
    kind: z.enum(["refund", "chargeback"]),
    grumbles: grumblesSchema,
    /** The money this case gave back. */
    money: moneySchema,
    occurredAt: isoDateTime,
  }),
);
