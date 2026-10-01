import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { LocalizedText } from "../domain/catalog.js";
import { subscriptionStates } from "../domain/lifecycle.js";
import { currencies } from "../domain/money.js";
import { periodicities } from "../domain/periods.js";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
/** Money is stored in integer minor units; JS float never takes part. */
const minor = (name: string) => bigint(name, { mode: "bigint" });

export const { outbox, inbox } = platformTables;

export const productKinds = ["subscription", "one_time"] as const;
export const orderStatuses = ["pending", "paid", "failed", "refunded"] as const;
export const attemptStates = [
  "requesting",
  "ready",
  "failed",
  "unknown",
] as const;
export const paymentKinds = [
  "purchase",
  "subscription_initial",
  "subscription_renewal",
] as const;
export const paymentStates = ["confirmed", "refunded", "disputed"] as const;
export const periodStates = ["paid", "refunded"] as const;
export const grantSources = ["purchase", "subscription", "manual"] as const;
export const grantStates = ["active", "revoked", "expired"] as const;
export const eventSources = ["webhook", "reconciliation"] as const;
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
export const caseKinds = ["refund", "chargeback"] as const;
export const caseStates = [
  "requested",
  "unmatched",
  "review_required",
  "recorded",
  "open",
] as const;
export const severities = ["low", "medium", "high"] as const;

/**
 * Buyer contact projection from Identity events. Lava needs the email for
 * invoices and cancellation; `accessVersion` lets admin commands reject
 * tokens issued before a role change.
 */
export const customers = pgTable("customers", {
  userId: uuid("user_id").primaryKey(),
  email: text("email"),
  emailVerified: boolean("email_verified").notNull().default(false),
  locale: text("locale", { enum: ["en", "ru"] })
    .notNull()
    .default("en"),
  status: text("status").notNull().default("active"),
  /** The newest access version seen: status and role changes both bump it. */
  accessVersion: integer("access_version").notNull().default(0),
  /**
   * Identity's accessVersion of the status stored here: a status event
   * older than it changes nothing. Role changes leave it alone.
   */
  statusVersion: integer("status_version").notNull().default(0),
  /**
   * The user's aggregateVersion in Identity when the email (with its
   * verification) and the locale stored here were published: an event not
   * newer than it leaves that field alone. 0: not known yet.
   */
  contactVersion: integer("contact_version").notNull().default(0),
  localeVersion: integer("locale_version").notNull().default(0),
  updatedAt: at("updated_at").notNull(),
});

/** What we sell, keyed by our product key. Synced from the code catalog. */
export const products = pgTable(
  "products",
  {
    key: text("key").primaryKey(),
    service: text("service").notNull(),
    feature: text("feature").notNull(),
    kind: text("kind", { enum: productKinds }).notNull(),
    periodicity: text("periodicity", { enum: periodicities }).notNull(),
    provider: text("provider").notNull(),
    providerOfferId: text("provider_offer_id").notNull(),
    /** Days of access after the paid period ends (subscriptions). */
    graceDays: integer("grace_days").notNull().default(0),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    description: jsonb("description").$type<LocalizedText>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [uniqueIndex("products_offer_uq").on(t.provider, t.providerOfferId)],
);

/**
 * Immutable price versions. A change closes the current row (`validUntil`)
 * and adds the next version; orders keep a snapshot of the one they used.
 */
export const prices = pgTable(
  "prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productKey: text("product_key")
      .notNull()
      .references(() => products.key),
    currency: text("currency", { enum: currencies }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    version: integer("version").notNull(),
    validFrom: at("valid_from").notNull(),
    validUntil: at("valid_until"),
  },
  (t) => [
    uniqueIndex("prices_version_uq").on(t.productKey, t.currency, t.version),
    uniqueIndex("prices_current_uq")
      .on(t.productKey, t.currency)
      .where(sql`${t.validUntil} is null`),
    check("prices_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/** A purchase intent with a frozen price and grant snapshot. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    productKey: text("product_key")
      .notNull()
      .references(() => products.key),
    priceId: uuid("price_id")
      .notNull()
      .references(() => prices.id),
    priceVersion: integer("price_version").notNull(),
    kind: text("kind", { enum: productKinds }).notNull(),
    service: text("service").notNull(),
    feature: text("feature").notNull(),
    periodicity: text("periodicity", { enum: periodicities }).notNull(),
    graceDays: integer("grace_days").notNull(),
    providerOfferId: text("provider_offer_id").notNull(),
    title: jsonb("title").$type<LocalizedText>().notNull(),
    currency: text("currency", { enum: currencies }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    status: text("status", { enum: orderStatuses })
      .notNull()
      .default("pending"),
    correlationId: text("correlation_id").notNull(),
    paidAt: at("paid_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("orders_user_idx").on(t.userId, t.createdAt),
    index("orders_status_idx").on(t.status, t.createdAt),
    check("orders_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/**
 * One provider call per order: saved before the network, unique per
 * (user, Idempotency-Key). `unknown` means the invoice may exist; it is
 * reconciled, never re-created blindly.
 */
export const checkoutAttempts = pgTable(
  "checkout_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    userId: uuid("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    state: text("state", { enum: attemptStates }).notNull(),
    provider: text("provider").notNull(),
    providerInvoiceId: text("provider_invoice_id"),
    paymentUrl: text("payment_url"),
    /** The email sent to Lava; cancellation and matching use this, not the current one. */
    buyerEmail: text("buyer_email").notNull(),
    buyerLanguage: text("buyer_language").notNull(),
    returnUrl: text("return_url").notNull(),
    failureReason: text("failure_reason"),
    checks: integer("checks").notNull().default(0),
    nextCheckAt: at("next_check_at"),
    requestedAt: at("requested_at").notNull(),
    resolvedAt: at("resolved_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("checkout_attempts_key_uq").on(t.userId, t.idempotencyKey),
    uniqueIndex("checkout_attempts_invoice_uq").on(
      t.provider,
      t.providerInvoiceId,
    ),
    index("checkout_attempts_due_idx")
      .on(t.nextCheckAt)
      .where(sql`${t.nextCheckAt} is not null`),
  ],
);

/**
 * Created by the first confirmed payment. Provider status is kept apart
 * from our normalized state; access follows `paidUntil` + grace.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id),
    productKey: text("product_key").notNull(),
    service: text("service").notNull(),
    feature: text("feature").notNull(),
    periodicity: text("periodicity", { enum: periodicities }).notNull(),
    graceDays: integer("grace_days").notNull(),
    currency: text("currency", { enum: currencies }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    provider: text("provider").notNull(),
    providerParentContractId: text("provider_parent_contract_id").notNull(),
    buyerEmail: text("buyer_email").notNull(),
    state: text("state", { enum: subscriptionStates }).notNull(),
    providerStatus: text("provider_status"),
    autoRenew: boolean("auto_renew").notNull().default(true),
    paidUntil: at("paid_until").notNull(),
    cancelRequestedAt: at("cancel_requested_at"),
    cancelledAt: at("cancelled_at"),
    providerExpiresAt: at("provider_expires_at"),
    expiredAt: at("expired_at"),
    cancelAttempts: integer("cancel_attempts").notNull().default(0),
    nextCancelAttemptAt: at("next_cancel_attempt_at"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("subscriptions_parent_uq").on(
      t.provider,
      t.providerParentContractId,
    ),
    index("subscriptions_user_idx").on(t.userId, t.createdAt),
    index("subscriptions_due_idx")
      .on(t.paidUntil)
      .where(sql`${t.state} <> 'expired'`),
  ],
);

/** A confirmed provider payment; the contract id is unique per provider. */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id),
    userId: uuid("user_id").notNull(),
    provider: text("provider").notNull(),
    providerContractId: text("provider_contract_id").notNull(),
    kind: text("kind", { enum: paymentKinds }).notNull(),
    currency: text("currency", { enum: currencies }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    state: text("state", { enum: paymentStates })
      .notNull()
      .default("confirmed"),
    /** When the provider says the money moved. */
    paidAt: at("paid_at").notNull(),
    /** When we recorded it. */
    confirmedAt: at("confirmed_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("payments_contract_uq").on(t.provider, t.providerContractId),
    index("payments_user_idx").on(t.userId, t.confirmedAt),
    index("payments_order_idx").on(t.orderId),
    index("payments_subscription_idx").on(t.subscriptionId),
    check("payments_amount_positive", sql`${t.amountMinor} > 0`),
  ],
);

/** One paid interval per payment; a repeated event cannot add days. */
export const billingPeriods = pgTable(
  "billing_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    paymentId: uuid("payment_id")
      .notNull()
      .unique()
      .references(() => payments.id),
    periodStart: at("period_start").notNull(),
    periodEnd: at("period_end").notNull(),
    state: text("state", { enum: periodStates }).notNull().default("paid"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [
    index("billing_periods_subscription_idx").on(
      t.subscriptionId,
      t.periodStart,
    ),
    check("billing_periods_order", sql`${t.periodEnd} > ${t.periodStart}`),
  ],
);

/**
 * Commercial access, one row per source and feature. `version` is the
 * aggregateVersion of billing.grant.changed; it grows on every change.
 */
export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    service: text("service").notNull(),
    feature: text("feature").notNull(),
    sourceType: text("source_type", { enum: grantSources }).notNull(),
    sourceId: uuid("source_id").notNull(),
    state: text("state", { enum: grantStates }).notNull(),
    validFrom: at("valid_from").notNull(),
    /** null only for an explicitly perpetual grant. */
    validUntil: at("valid_until"),
    reason: text("reason"),
    grantedBy: uuid("granted_by"),
    revokedAt: at("revoked_at"),
    revokedBy: uuid("revoked_by"),
    revokeReason: text("revoke_reason"),
    version: integer("version").notNull().default(1),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("grants_source_uq").on(
      t.sourceType,
      t.sourceId,
      t.service,
      t.feature,
    ),
    uniqueIndex("grants_manual_active_uq")
      .on(t.userId, t.service, t.feature)
      .where(sql`${t.sourceType} = 'manual' and ${t.state} = 'active'`),
    index("grants_user_idx").on(t.userId),
    index("grants_expiry_idx")
      .on(t.validUntil)
      .where(sql`${t.state} = 'active' and ${t.validUntil} is not null`),
  ],
);

/**
 * Every authenticated webhook (and every fact found by reconciliation),
 * stored before it has any effect. `payload` is private raw data.
 */
export const providerEvents = pgTable(
  "provider_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    source: text("source", { enum: eventSources }).notNull(),
    /** Semantic dedupe key (event_id, or type + contract + status). */
    eventKey: text("event_key").notNull(),
    type: text("type").notNull(),
    rawType: text("raw_type"),
    status: text("status", { enum: eventStatuses }).notNull(),
    note: text("note"),
    payload: jsonb("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    fact: jsonb("fact"),
    contractId: text("contract_id"),
    parentContractId: text("parent_contract_id"),
    orderId: uuid("order_id"),
    subscriptionId: uuid("subscription_id"),
    paymentId: uuid("payment_id"),
    refundId: uuid("refund_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: at("next_attempt_at"),
    receivedAt: at("received_at").notNull(),
    processedAt: at("processed_at"),
  },
  (t) => [
    uniqueIndex("provider_events_key_uq").on(t.provider, t.eventKey),
    index("provider_events_contract_idx").on(t.contractId),
    index("provider_events_order_idx").on(t.orderId),
    index("provider_events_received_idx").on(t.receivedAt),
    index("provider_events_retry_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('received', 'unmatched', 'failed')`),
  ],
);

/** Refund and chargeback cases; `paymentId` only after a verified match. */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: caseKinds }).notNull(),
    provider: text("provider").notNull(),
    /** Lava refund_id / chargeback_id once the provider reported it. */
    providerRef: text("provider_ref"),
    paymentId: uuid("payment_id").references(() => payments.id),
    userId: uuid("user_id"),
    currency: text("currency", { enum: currencies }),
    amountMinor: minor("amount_minor"),
    refundType: text("refund_type", { enum: ["full", "partial"] }),
    state: text("state", { enum: caseStates }).notNull(),
    reason: text("reason"),
    evidence: jsonb("evidence").notNull().default({}),
    requestedBy: uuid("requested_by"),
    providerEventId: uuid("provider_event_id"),
    createdAt: at("created_at").notNull(),
    updatedAt: at("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    uniqueIndex("refunds_provider_ref_uq").on(
      t.provider,
      t.kind,
      t.providerRef,
    ),
    index("refunds_payment_idx").on(t.paymentId),
    index("refunds_state_idx").on(t.state, t.createdAt),
  ],
);

/** Immutable money journal: one row per financial effect (signed minor units). */
export const financialEntries = pgTable(
  "financial_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: ["payment", "refund"] }).notNull(),
    sourceRef: text("source_ref").notNull().unique(),
    paymentId: uuid("payment_id"),
    refundId: uuid("refund_id"),
    userId: uuid("user_id"),
    currency: text("currency", { enum: currencies }).notNull(),
    amountMinor: minor("amount_minor").notNull(),
    occurredAt: at("occurred_at").notNull(),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("financial_entries_time_idx").on(t.occurredAt)],
);

/** Discrepancies for an operator; one row per subject, counted on repeats. */
export const reconciliationIssues = pgTable(
  "reconciliation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    severity: text("severity", { enum: severities }).notNull(),
    status: text("status", { enum: ["open", "resolved"] })
      .notNull()
      .default("open"),
    subjectKey: text("subject_key").notNull().unique(),
    related: jsonb("related").notNull().default({}),
    evidence: jsonb("evidence").notNull().default({}),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: at("first_seen_at").notNull(),
    lastSeenAt: at("last_seen_at").notNull(),
    resolvedAt: at("resolved_at"),
    resolvedBy: uuid("resolved_by"),
    resolution: text("resolution"),
  },
  (t) => [
    index("reconciliation_issues_status_idx").on(t.status, t.firstSeenAt),
  ],
);

/** Append-only record of administrative actions. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason"),
    data: jsonb("data").notNull().default({}),
    requestId: text("request_id"),
    createdAt: at("created_at").notNull(),
  },
  (t) => [index("audit_target_idx").on(t.targetType, t.targetId, t.createdAt)],
);
