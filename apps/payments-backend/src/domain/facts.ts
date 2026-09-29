import { z } from "zod";
import { currencies } from "./money.js";

const id = z.string().min(1).max(128);
const instant = z.iso.datetime({ offset: true });
/** Decimal text exactly as the provider sent it; converted with toMinor. */
const decimal = z.string().regex(/^\d{1,13}(\.\d{1,20})?$/);

/**
 * Provider facts, independent of how we learned them (webhook or
 * reconciliation). Stored as JSON on the provider event and re-applied
 * through the same code path, so both sources settle idempotently.
 */
export const paymentFactSchema = z.object({
  kind: z.literal("payment"),
  outcome: z.enum(["success", "failed"]),
  /** A renewal of an existing subscription (has a parent contract). */
  recurring: z.boolean(),
  contractId: id,
  parentContractId: id.nullable(),
  amount: decimal,
  currency: z.enum(currencies),
  providerStatus: z.string().max(64).nullable(),
  occurredAt: instant,
  errorMessage: z.string().max(500).nullable(),
});

export const cancellationFactSchema = z.object({
  kind: z.literal("cancellation"),
  contractId: id,
  cancelledAt: instant.nullable(),
  willExpireAt: instant.nullable(),
});

export const refundFactSchema = z.object({
  kind: z.literal("refund"),
  refundId: id,
  refundType: z.enum(["full", "partial"]),
  amount: decimal,
  currency: z.enum(currencies),
  /** Lava tier_id: the offer that was refunded. */
  offerId: id.nullable(),
  customerEmail: z.string().max(320).nullable(),
  subscriptionCancelled: z.boolean(),
  /** Only when the provider names the contract; the documented payload does not. */
  contractId: id.nullable(),
  occurredAt: instant.nullable(),
});

export const chargebackFactSchema = z.object({
  kind: z.literal("chargeback"),
  chargebackId: id,
  amount: decimal,
  currency: z.enum(currencies),
  offerId: id.nullable(),
  customerEmail: z.string().max(320).nullable(),
  reasonCategory: z.string().max(100).nullable(),
  contractId: id.nullable(),
  occurredAt: instant.nullable(),
});

export const factSchema = z.discriminatedUnion("kind", [
  paymentFactSchema,
  cancellationFactSchema,
  refundFactSchema,
  chargebackFactSchema,
]);

export type PaymentFact = z.infer<typeof paymentFactSchema>;
export type CancellationFact = z.infer<typeof cancellationFactSchema>;
export type RefundFact = z.infer<typeof refundFactSchema>;
export type ChargebackFact = z.infer<typeof chargebackFactSchema>;
export type Fact = z.infer<typeof factSchema>;
