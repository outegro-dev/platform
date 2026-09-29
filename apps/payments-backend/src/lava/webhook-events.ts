import { createHash } from "node:crypto";
import { z } from "zod";
import type { Fact } from "../domain/facts.js";
import { currencies, MoneyError, toMinor } from "../domain/money.js";

/**
 * Lava webhook payloads → provider facts (pure, no I/O).
 *
 * Two documented shapes (OpenAPI 1.22.0, /example-of-webhook-route-contract):
 * payments and subscriptions arrive as a flat camelCase object without an
 * event id; refunds and chargebacks as a snake_case envelope with event_id.
 */

export type NormalizedEvent =
  | {
      status: "received";
      key: string;
      type: string;
      rawType: string;
      fact: Fact;
      contractId: string | null;
      parentContractId: string | null;
      hash: string;
    }
  | {
      status: "quarantined" | "invalid";
      key: string;
      type: "unknown" | "invalid";
      rawType: string | null;
      note: string;
      contractId: string | null;
      hash: string;
    };

const paymentTypes = [
  "payment.success",
  "payment.failed",
  "subscription.recurring.payment.success",
  "subscription.recurring.payment.failed",
] as const;
const SUCCESS_STATUSES = new Set(["completed", "subscription-active"]);

/** Every event type this adapter understands. */
const knownTypes: readonly unknown[] = [
  ...paymentTypes,
  "subscription.cancelled",
  "refund.success",
  "chargeback.initiated",
];

/** The type a payload claims when it is a known one, else `other` (metrics). */
export function eventTypeLabel(payload: unknown): string {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const type = record.eventType ?? record.event_type;
  return knownTypes.includes(type) ? String(type) : "other";
}

const id = z.string().trim().min(1).max(128);
const amount = z.union([
  z.number().finite().nonnegative(),
  z.string().regex(/^\d{1,13}(\.\d{1,20})?$/),
]);
const instant = z
  .string()
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), "invalid date");
const currency = z.enum(currencies);
const email = z.string().max(320).nullish();

const paymentPayload = z.object({
  eventType: z.enum(paymentTypes),
  contractId: id,
  parentContractId: id.nullish(),
  amount,
  currency,
  status: z.string().min(1).max(64),
  timestamp: instant,
  errorMessage: z.string().nullish(),
});

const cancellationPayload = z.object({
  eventType: z.literal("subscription.cancelled"),
  contractId: id,
  cancelledAt: instant.nullish(),
  willExpireAt: instant.nullish(),
});

const envelopePayload = z.object({
  event_id: id,
  event_type: z.string().min(1).max(100),
  created_at: instant.nullish(),
  data: z.record(z.string(), z.unknown()),
});

const productRef = z
  .object({
    product_id: z.string().nullish(),
    tier_id: z.string().nullish(),
  })
  .nullish();

const refundData = z.object({
  refund_id: id,
  refund_type: z.enum(["full", "partial"]),
  amount,
  currency,
  product: productRef,
  customer_email: email,
  subscription_cancelled: z.boolean().nullish(),
  // Not in the documented example; used for an exact match when present.
  contract_id: id.nullish(),
  invoice_id: id.nullish(),
});

const chargebackData = z.object({
  chargeback_id: id,
  amount,
  currency,
  product: productRef,
  customer_email: email,
  reason_category: z.string().max(100).nullish(),
  contract_id: id.nullish(),
  invoice_id: id.nullish(),
});

/** JSON with sorted keys: the same content always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const payloadHash = (payload: unknown) =>
  createHash("sha256").update(canonical(payload)).digest("hex");

const iso = (value: string) => new Date(value).toISOString();
const decimalText = (value: number | string) =>
  typeof value === "number" ? String(value) : value;

/** Paths of the problems only: payload values (emails) never go to logs. */
const issuesOf = (error: z.ZodError) =>
  error.issues
    .map((issue) => issue.path.join(".") || "(root)")
    .slice(0, 5)
    .join(", ");

function checkAmount(value: number | string, cur: (typeof currencies)[number]) {
  try {
    toMinor(value, cur);
    return null;
  } catch (error) {
    return error instanceof MoneyError ? error.message : "invalid amount";
  }
}

export function normalizeLavaEvent(payload: unknown): NormalizedEvent {
  const hash = payloadHash(payload);
  const invalid = (
    rawType: string | null,
    note: string,
    contractId: string | null = null,
  ): NormalizedEvent => ({
    status: "invalid",
    key: `invalid:${hash}`,
    type: "invalid",
    rawType,
    note,
    contractId,
    hash,
  });
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return invalid(null, "payload is not an object");
  const record = payload as Record<string, unknown>;
  const rawContract =
    typeof record.contractId === "string" ? record.contractId : null;

  if (typeof record.eventType === "string") {
    const rawType = record.eventType.slice(0, 100);
    if ((paymentTypes as readonly string[]).includes(rawType)) {
      const parsed = paymentPayload.safeParse(payload);
      if (!parsed.success)
        return invalid(
          rawType,
          `schema: ${issuesOf(parsed.error)}`,
          rawContract,
        );
      const p = parsed.data;
      const recurring = rawType.startsWith("subscription.recurring.");
      const outcome = rawType.endsWith(".success") ? "success" : "failed";
      if (recurring && !p.parentContractId)
        return invalid(
          rawType,
          "recurring payment without parentContractId",
          p.contractId,
        );
      if (outcome === "success" && !SUCCESS_STATUSES.has(p.status))
        return invalid(
          rawType,
          `status ${p.status} contradicts ${rawType}`,
          p.contractId,
        );
      const amountError = checkAmount(p.amount, p.currency);
      if (amountError) return invalid(rawType, amountError, p.contractId);
      return {
        status: "received",
        key: `${rawType}:${p.contractId}:${p.status}`,
        type: rawType,
        rawType,
        contractId: p.contractId,
        parentContractId: p.parentContractId ?? null,
        hash,
        fact: {
          kind: "payment",
          outcome,
          recurring,
          contractId: p.contractId,
          parentContractId: p.parentContractId ?? null,
          amount: decimalText(p.amount),
          currency: p.currency,
          providerStatus: p.status,
          occurredAt: iso(p.timestamp),
          errorMessage: p.errorMessage ? p.errorMessage.slice(0, 500) : null,
        },
      };
    }
    if (rawType === "subscription.cancelled") {
      const parsed = cancellationPayload.safeParse(payload);
      if (!parsed.success)
        return invalid(
          rawType,
          `schema: ${issuesOf(parsed.error)}`,
          rawContract,
        );
      const p = parsed.data;
      return {
        status: "received",
        key: `subscription.cancelled:${p.contractId}`,
        type: rawType,
        rawType,
        contractId: p.contractId,
        parentContractId: null,
        hash,
        fact: {
          kind: "cancellation",
          contractId: p.contractId,
          cancelledAt: p.cancelledAt ? iso(p.cancelledAt) : null,
          willExpireAt: p.willExpireAt ? iso(p.willExpireAt) : null,
        },
      };
    }
    return {
      status: "quarantined",
      key: `unknown:${hash}`,
      type: "unknown",
      rawType,
      note: "unknown event type",
      contractId: rawContract,
      hash,
    };
  }

  if (typeof record.event_type === "string") {
    const envelope = envelopePayload.safeParse(payload);
    const rawType = record.event_type.slice(0, 100);
    if (!envelope.success)
      return invalid(rawType, `schema: ${issuesOf(envelope.error)}`);
    const e = envelope.data;
    const key = `event:${e.event_id}`;
    const occurredAt = e.created_at ? iso(e.created_at) : null;
    if (e.event_type === "refund.success") {
      const parsed = refundData.safeParse(e.data);
      if (!parsed.success)
        return invalid(rawType, `schema: data.${issuesOf(parsed.error)}`);
      const d = parsed.data;
      const amountError = checkAmount(d.amount, d.currency);
      if (amountError) return invalid(rawType, amountError);
      const contractId = d.contract_id ?? d.invoice_id ?? null;
      return {
        status: "received",
        key,
        type: e.event_type,
        rawType,
        contractId,
        parentContractId: null,
        hash,
        fact: {
          kind: "refund",
          refundId: d.refund_id,
          refundType: d.refund_type,
          amount: decimalText(d.amount),
          currency: d.currency,
          offerId: d.product?.tier_id ?? null,
          customerEmail: d.customer_email ?? null,
          subscriptionCancelled: d.subscription_cancelled ?? false,
          contractId,
          occurredAt,
        },
      };
    }
    if (e.event_type === "chargeback.initiated") {
      const parsed = chargebackData.safeParse(e.data);
      if (!parsed.success)
        return invalid(rawType, `schema: data.${issuesOf(parsed.error)}`);
      const d = parsed.data;
      const amountError = checkAmount(d.amount, d.currency);
      if (amountError) return invalid(rawType, amountError);
      const contractId = d.contract_id ?? d.invoice_id ?? null;
      return {
        status: "received",
        key,
        type: e.event_type,
        rawType,
        contractId,
        parentContractId: null,
        hash,
        fact: {
          kind: "chargeback",
          chargebackId: d.chargeback_id,
          amount: decimalText(d.amount),
          currency: d.currency,
          offerId: d.product?.tier_id ?? null,
          customerEmail: d.customer_email ?? null,
          reasonCategory: d.reason_category ?? null,
          contractId,
          occurredAt,
        },
      };
    }
    return {
      status: "quarantined",
      key,
      type: "unknown",
      rawType,
      note: "unknown event type",
      contractId: null,
      hash,
    };
  }

  return invalid(null, "neither eventType nor event_type");
}
