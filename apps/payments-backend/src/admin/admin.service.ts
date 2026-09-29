import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { AccountService } from "../account/account.service.js";
import { grantView, paymentView, subscriptionView } from "../account/views.js";
import { GrantLedger } from "../billing/grants.js";
import { type Actor, audit } from "../common/audit.js";
import { after, type Cursor, page } from "../common/cursor.js";
import {
  isUniqueViolation,
  type PaymentsDatabase,
  type ProviderEventRow,
  type RefundRow,
} from "../common/database.js";
import {
  auditLog,
  checkoutAttempts,
  grants,
  orders,
  payments,
  providerEvents,
  reconciliationIssues,
  refunds,
  subscriptions,
} from "../db/schema.js";
import { type Currency, isCurrency, moneyDto } from "../domain/money.js";

const iso = (value: Date | null) => value?.toISOString() ?? null;
const DAY_MS = 86_400_000;

export const eventView = (event: ProviderEventRow, withPayload = false) => ({
  id: event.id,
  source: event.source,
  type: event.type,
  rawType: event.rawType,
  status: event.status,
  note: event.note,
  contractId: event.contractId,
  parentContractId: event.parentContractId,
  orderId: event.orderId,
  subscriptionId: event.subscriptionId,
  paymentId: event.paymentId,
  refundId: event.refundId,
  attempts: event.attempts,
  lastError: event.lastError,
  payloadHash: event.payloadHash,
  receivedAt: event.receivedAt.toISOString(),
  processedAt: iso(event.processedAt),
  // Raw payloads hold buyer emails: only on the single-event view.
  ...(withPayload ? { payload: event.payload, fact: event.fact } : {}),
});

export const refundView = (row: RefundRow) => ({
  id: row.id,
  kind: row.kind,
  state: row.state,
  providerRef: row.providerRef,
  paymentId: row.paymentId,
  userId: row.userId,
  refundType: row.refundType,
  money:
    row.amountMinor !== null && row.currency
      ? moneyDto(row.amountMinor, row.currency)
      : null,
  reason: row.reason,
  evidence: row.evidence,
  requestedBy: row.requestedBy,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

type Filter = { cursor: Cursor | null; limit: number };

/** Read models and commands behind the admin API. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly account: AccountService,
    private readonly grants: GrantLedger,
    private readonly relay: OutboxRelay,
  ) {}

  async orders(
    filter: Filter & {
      status?: (typeof orders.$inferSelect)["status"];
      userId?: string;
      productKey?: string;
      from?: Date;
      to?: Date;
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(orders)
      .where(
        and(
          filter.status ? eq(orders.status, filter.status) : undefined,
          filter.userId ? eq(orders.userId, filter.userId) : undefined,
          filter.productKey
            ? eq(orders.productKey, filter.productKey)
            : undefined,
          filter.from ? gte(orders.createdAt, filter.from) : undefined,
          filter.to ? lt(orders.createdAt, filter.to) : undefined,
          after(filter.cursor, orders.createdAt, orders.id),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.createdAt,
      id: row.id,
    }));
    const views = await this.account.withDetails(result.items);
    return {
      items: views.map((view, index) => ({
        ...view,
        userId: result.items[index]?.userId,
      })),
      nextCursor: result.nextCursor,
    };
  }

  /** Everything around one order: attempt, payments, subscription, grants, events, audit. */
  async order(orderId: string) {
    const [order] = await this.database.db
      .select()
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) throw new AppError("NOT_FOUND");
    const [view] = await this.account.withDetails([order]);
    const [attempt] = await this.database.db
      .select()
      .from(checkoutAttempts)
      .where(eq(checkoutAttempts.orderId, order.id));
    const paymentRows = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, order.id))
      .orderBy(desc(payments.confirmedAt));
    const [subscription] = await this.database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.orderId, order.id));
    const grantRows = await this.database.db
      .select()
      .from(grants)
      .where(
        or(
          and(eq(grants.sourceType, "purchase"), eq(grants.sourceId, order.id)),
          subscription
            ? and(
                eq(grants.sourceType, "subscription"),
                eq(grants.sourceId, subscription.id),
              )
            : undefined,
        ),
      );
    const contracts = [
      attempt?.providerInvoiceId,
      ...paymentRows.map((payment) => payment.providerContractId),
    ].filter((value): value is string => !!value);
    const eventRows = await this.database.db
      .select()
      .from(providerEvents)
      .where(
        or(
          eq(providerEvents.orderId, order.id),
          contracts.length
            ? inArray(providerEvents.contractId, contracts)
            : undefined,
          subscription
            ? eq(providerEvents.subscriptionId, subscription.id)
            : undefined,
        ),
      )
      .orderBy(desc(providerEvents.receivedAt))
      .limit(200);
    const paymentIds = paymentRows.map((payment) => payment.id);
    const refundRows = paymentIds.length
      ? await this.database.db
          .select()
          .from(refunds)
          .where(inArray(refunds.paymentId, paymentIds))
      : [];
    const targets = [
      order.id,
      ...(subscription ? [subscription.id] : []),
      ...paymentIds,
      ...grantRows.map((grant) => grant.id),
      ...refundRows.map((refund) => refund.id),
    ];
    const auditRows = await this.database.db
      .select()
      .from(auditLog)
      .where(inArray(auditLog.targetId, targets))
      .orderBy(desc(auditLog.createdAt));
    return {
      order: {
        ...view,
        userId: order.userId,
        correlationId: order.correlationId,
      },
      attempt: attempt
        ? {
            id: attempt.id,
            state: attempt.state,
            providerInvoiceId: attempt.providerInvoiceId,
            failureReason: attempt.failureReason,
            checks: attempt.checks,
            nextCheckAt: iso(attempt.nextCheckAt),
            requestedAt: attempt.requestedAt.toISOString(),
            resolvedAt: iso(attempt.resolvedAt),
          }
        : null,
      payments: paymentRows.map(paymentView),
      subscription: subscription
        ? subscriptionView(subscription, order.title)
        : null,
      grants: grantRows.map(grantView),
      refunds: refundRows.map(refundView),
      events: eventRows.map((event) => eventView(event)),
      audit: auditRows.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason,
        data: row.data,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async payments(
    filter: Filter & {
      userId?: string;
      orderId?: string;
      state?: (typeof payments.$inferSelect)["state"];
      currency?: Currency;
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(payments)
      .where(
        and(
          filter.userId ? eq(payments.userId, filter.userId) : undefined,
          filter.orderId ? eq(payments.orderId, filter.orderId) : undefined,
          filter.state ? eq(payments.state, filter.state) : undefined,
          filter.currency ? eq(payments.currency, filter.currency) : undefined,
          after(filter.cursor, payments.confirmedAt, payments.id),
        ),
      )
      .orderBy(desc(payments.confirmedAt), desc(payments.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.confirmedAt,
      id: row.id,
    }));
    return {
      items: result.items.map(paymentView),
      nextCursor: result.nextCursor,
    };
  }

  async subscriptions(
    filter: Filter & {
      userId?: string;
      state?: (typeof subscriptions.$inferSelect)["state"];
      productKey?: string;
    },
  ) {
    const rows = await this.database.db
      .select({ subscription: subscriptions, title: orders.title })
      .from(subscriptions)
      .innerJoin(orders, eq(orders.id, subscriptions.orderId))
      .where(
        and(
          filter.userId ? eq(subscriptions.userId, filter.userId) : undefined,
          filter.state ? eq(subscriptions.state, filter.state) : undefined,
          filter.productKey
            ? eq(subscriptions.productKey, filter.productKey)
            : undefined,
          after(filter.cursor, subscriptions.createdAt, subscriptions.id),
        ),
      )
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.subscription.createdAt,
      id: row.subscription.id,
    }));
    return {
      items: result.items.map((row) => ({
        ...subscriptionView(row.subscription, row.title),
        userId: row.subscription.userId,
        providerStatus: row.subscription.providerStatus,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async events(
    filter: Filter & {
      status?: ProviderEventRow["status"];
      type?: string;
      contractId?: string;
      orderId?: string;
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(providerEvents)
      .where(
        and(
          filter.status ? eq(providerEvents.status, filter.status) : undefined,
          filter.type ? eq(providerEvents.type, filter.type) : undefined,
          filter.contractId
            ? eq(providerEvents.contractId, filter.contractId)
            : undefined,
          filter.orderId
            ? eq(providerEvents.orderId, filter.orderId)
            : undefined,
          after(filter.cursor, providerEvents.receivedAt, providerEvents.id),
        ),
      )
      .orderBy(desc(providerEvents.receivedAt), desc(providerEvents.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.receivedAt,
      id: row.id,
    }));
    return {
      items: result.items.map((row) => eventView(row)),
      nextCursor: result.nextCursor,
    };
  }

  async event(eventId: string) {
    const [row] = await this.database.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.id, eventId));
    if (!row) throw new AppError("NOT_FOUND");
    return eventView(row, true);
  }

  async issues(
    filter: Filter & { status?: "open" | "resolved"; kind?: string },
  ) {
    const rows = await this.database.db
      .select()
      .from(reconciliationIssues)
      .where(
        and(
          filter.status
            ? eq(reconciliationIssues.status, filter.status)
            : undefined,
          filter.kind ? eq(reconciliationIssues.kind, filter.kind) : undefined,
          after(
            filter.cursor,
            reconciliationIssues.firstSeenAt,
            reconciliationIssues.id,
          ),
        ),
      )
      .orderBy(
        desc(reconciliationIssues.firstSeenAt),
        desc(reconciliationIssues.id),
      )
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.firstSeenAt,
      id: row.id,
    }));
    return {
      items: result.items.map((row) => ({
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        status: row.status,
        subjectKey: row.subjectKey,
        related: row.related,
        evidence: row.evidence,
        occurrences: row.occurrences,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        resolvedAt: iso(row.resolvedAt),
        resolution: row.resolution,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async grantList(
    filter: Filter & {
      userId?: string;
      state?: (typeof grants.$inferSelect)["state"];
      sourceType?: (typeof grants.$inferSelect)["sourceType"];
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(grants)
      .where(
        and(
          filter.userId ? eq(grants.userId, filter.userId) : undefined,
          filter.state ? eq(grants.state, filter.state) : undefined,
          filter.sourceType
            ? eq(grants.sourceType, filter.sourceType)
            : undefined,
          after(filter.cursor, grants.createdAt, grants.id),
        ),
      )
      .orderBy(desc(grants.createdAt), desc(grants.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.createdAt,
      id: row.id,
    }));
    return {
      items: result.items.map((row) => ({
        ...grantView(row),
        reason: row.reason,
        grantedBy: row.grantedBy,
        revokedAt: iso(row.revokedAt),
        revokedBy: row.revokedBy,
        revokeReason: row.revokeReason,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async refundList(
    filter: Filter & { state?: RefundRow["state"]; kind?: RefundRow["kind"] },
  ) {
    const rows = await this.database.db
      .select()
      .from(refunds)
      .where(
        and(
          filter.state ? eq(refunds.state, filter.state) : undefined,
          filter.kind ? eq(refunds.kind, filter.kind) : undefined,
          after(filter.cursor, refunds.createdAt, refunds.id),
        ),
      )
      .orderBy(desc(refunds.createdAt), desc(refunds.id))
      .limit(filter.limit + 1);
    const result = page(rows, filter.limit, (row) => ({
      at: row.createdAt,
      id: row.id,
    }));
    return {
      items: result.items.map(refundView),
      nextCursor: result.nextCursor,
    };
  }

  /** Access given by an operator: sourceType manual, reason and audit required. */
  async grant(
    actor: Actor,
    input: {
      userId: string;
      service: string;
      feature: string;
      validUntil: Date | null;
      reason: string;
    },
  ) {
    const now = this.clock.now();
    if (input.validUntil && input.validUntil <= now)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { validUntil: ["must be in the future"] },
      });
    try {
      const grant = await this.database.db.transaction(async (tx) => {
        const [active] = await tx
          .select({ id: grants.id })
          .from(grants)
          .where(
            and(
              eq(grants.userId, input.userId),
              eq(grants.service, input.service),
              eq(grants.feature, input.feature),
              eq(grants.sourceType, "manual"),
              eq(grants.state, "active"),
            ),
          )
          .for("update");
        if (active)
          throw new AppError("CONFLICT", {
            message: "an active manual grant exists",
          });
        const row = await this.grants.activate(
          tx,
          {
            userId: input.userId,
            service: input.service,
            feature: input.feature,
            sourceType: "manual",
            sourceId: randomUUID(),
          },
          { validFrom: now, validUntil: input.validUntil },
          now,
          actor.requestId ?? undefined,
          { reason: input.reason, grantedBy: actor.userId },
        );
        await audit(tx, {
          actor,
          action: "grant.created",
          targetType: "grant",
          targetId: row.id,
          reason: input.reason,
          data: {
            userId: input.userId,
            service: input.service,
            feature: input.feature,
            validUntil: iso(input.validUntil),
          },
          at: now,
        });
        return row;
      });
      this.relay.kick();
      return grantView(grant);
    } catch (error) {
      if (isUniqueViolation(error, "grants_manual_active_uq"))
        throw new AppError("CONFLICT", {
          message: "an active manual grant exists",
        });
      throw error;
    }
  }

  /** Ends any grant with a reason; other sources of the same feature stay (TC-PAY-06-01). */
  async revoke(actor: Actor, grantId: string, reason: string) {
    const now = this.clock.now();
    const grant = await this.database.db.transaction(async (tx) => {
      const current = await this.grants.lockById(tx, grantId);
      if (!current) throw new AppError("NOT_FOUND");
      if (current.state !== "active")
        throw new AppError("UNPROCESSABLE", {
          fieldErrors: { grantId: [`grant is ${current.state}`] },
        });
      const row = await this.grants.revoke(
        tx,
        current,
        { actorId: actor.userId, reason },
        now,
        actor.requestId ?? undefined,
      );
      await audit(tx, {
        actor,
        action: "grant.revoked",
        targetType: "grant",
        targetId: row.id,
        reason,
        data: { sourceType: row.sourceType, sourceId: row.sourceId },
        at: now,
      });
      return row;
    });
    this.relay.kick();
    return grantView(grant);
  }

  /**
   * Revenue per UTC day and currency (never summed across currencies),
   * live subscriptions, and checkout conversion per product.
   */
  async stats(range: { from?: Date; to?: Date }) {
    const now = this.clock.now();
    const to = range.to ?? now;
    const from = range.from ?? new Date(to.getTime() - 30 * DAY_MS);
    if (from >= to)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { from: ["must be before to"] },
      });
    const [f, t, n] = [from.toISOString(), to.toISOString(), now.toISOString()];
    const byDay = await this.database.db.execute<{
      day: string;
      currency: string;
      gross: string;
      refunded: string;
      net: string;
      payments: number;
    }>(sql`
      select to_char(date_trunc('day', occurred_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
             currency,
             coalesce(sum(amount_minor) filter (where type = 'payment'), 0)::text as gross,
             coalesce(-sum(amount_minor) filter (where type = 'refund'), 0)::text as refunded,
             sum(amount_minor)::text as net,
             (count(*) filter (where type = 'payment'))::int as payments
        from financial_entries
       where occurred_at >= ${f}::timestamptz and occurred_at < ${t}::timestamptz
       group by 1, 2
       order by 1, 2`);
    const live = await this.database.db.execute<{
      product_key: string;
      count: number;
    }>(sql`
      select product_key, count(*)::int as count
        from subscriptions
       where state in ('active', 'past_due', 'cancel_requested', 'cancelling')
         and paid_until + make_interval(days => grace_days) > ${n}::timestamptz
       group by product_key
       order by product_key`);
    const conversion = await this.database.db.execute<{
      product_key: string;
      created: number;
      paid: number;
      failed: number;
      pending: number;
    }>(sql`
      select product_key,
             count(*)::int as created,
             (count(*) filter (where status in ('paid', 'refunded')))::int as paid,
             (count(*) filter (where status = 'failed'))::int as failed,
             (count(*) filter (where status = 'pending'))::int as pending
        from orders
       where created_at >= ${f}::timestamptz and created_at < ${t}::timestamptz
       group by product_key
       order by product_key`);
    const money = (minor: string, currency: string) =>
      isCurrency(currency) ? moneyDto(BigInt(minor), currency) : null;
    const totals = new Map<
      string,
      { gross: bigint; refunded: bigint; net: bigint; payments: number }
    >();
    for (const row of byDay.rows) {
      const total = totals.get(row.currency) ?? {
        gross: 0n,
        refunded: 0n,
        net: 0n,
        payments: 0,
      };
      total.gross += BigInt(row.gross);
      total.refunded += BigInt(row.refunded);
      total.net += BigInt(row.net);
      total.payments += row.payments;
      totals.set(row.currency, total);
    }
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      revenue: {
        byDay: byDay.rows.map((row) => ({
          day: row.day,
          currency: row.currency,
          gross: money(row.gross, row.currency),
          refunded: money(row.refunded, row.currency),
          net: money(row.net, row.currency),
          payments: row.payments,
        })),
        totals: [...totals.entries()].map(([currency, total]) => ({
          currency,
          gross: money(total.gross.toString(), currency),
          refunded: money(total.refunded.toString(), currency),
          net: money(total.net.toString(), currency),
          payments: total.payments,
        })),
      },
      activeSubscriptions: {
        total: live.rows.reduce((sum, row) => sum + row.count, 0),
        byProduct: live.rows.map((row) => ({
          productKey: row.product_key,
          count: row.count,
        })),
      },
      conversion: conversion.rows.map((row) => ({
        productKey: row.product_key,
        checkouts: row.created,
        paid: row.paid,
        failed: row.failed,
        pending: row.pending,
      })),
    };
  }
}
