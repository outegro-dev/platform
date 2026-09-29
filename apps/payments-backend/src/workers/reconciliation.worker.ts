import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, asc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { CancellationService } from "../billing/cancellation.js";
import { type IssueKind, IssueRegistry } from "../billing/issues.js";
import { ProviderEvents } from "../billing/provider-events.js";
import {
  type AttemptRow,
  isUniqueViolation,
  type OrderRow,
  type PaymentsDatabase,
} from "../common/database.js";
import { PaymentsMetrics } from "../common/metrics.js";
import { workersConfig } from "../config/config.js";
import { checkoutAttempts, orders } from "../db/schema.js";
import { type PaymentFact, paymentFactSchema } from "../domain/facts.js";
import { formatMinor, MoneyError, toMinor } from "../domain/money.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderInvoice,
} from "../lava/provider.js";
import { PeriodicWorker } from "./periodic-worker.js";

/** Next look at an open checkout: 1, 2, 5, 15, 30 min, 1, 2, 6, 12, 24 h; then an operator. */
const CHECK_DELAYS_MS = [
  60_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
  21_600_000, 43_200_000, 86_400_000,
];
const ISSUE_AFTER_CHECKS = 3;
const MINUTE_MS = 60_000;
/** An unknown attempt's invoice is created within this window after our request. */
const CREATED_WITHIN_MS = 15 * MINUTE_MS;
const SEARCH_DAYS_MS = 7 * 86_400_000;

/**
 * Reconciliation (PAY-10 scope for checkouts): open attempts are checked
 * at the provider and settled through the same fact path as webhooks,
 * so a missed webhook and a late one converge on one effect. Also retries
 * provider events and unanswered cancel calls. Clock-driven; off in tests.
 */
@Injectable()
export class ReconciliationWorker extends PeriodicWorker {
  protected readonly logger = new Logger("Reconciliation");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly events: ProviderEvents,
    private readonly cancellation: CancellationService,
    private readonly issues: IssueRegistry,
    private readonly metrics: PaymentsMetrics,
    @Inject(workersConfig.KEY) config: ConfigType<typeof workersConfig>,
  ) {
    super(config.autoStart, config.reconcileIntervalMs);
  }

  protected async runOnce() {
    let handled = await this.checkAttempts();
    handled += await this.events.retryDue();
    if (this.provider.configured) handled += await this.cancellation.retryDue();
    this.metrics.reconciliationFinished();
    return handled;
  }

  /** Every due attempt, in bounded batches; each check moves or clears its next time. */
  private async checkAttempts(batch = 20, maxBatches = 10) {
    let handled = 0;
    for (let round = 0; round < maxBatches; round++) {
      const now = this.clock.now();
      const due = await this.database.db
        .select({ attempt: checkoutAttempts, order: orders })
        .from(checkoutAttempts)
        .innerJoin(orders, eq(orders.id, checkoutAttempts.orderId))
        .where(
          and(
            isNotNull(checkoutAttempts.nextCheckAt),
            lte(checkoutAttempts.nextCheckAt, now),
          ),
        )
        .orderBy(asc(checkoutAttempts.nextCheckAt))
        .limit(batch);
      for (const { attempt, order } of due) await this.check(attempt, order);
      handled += due.length;
      if (due.length < batch) break;
    }
    return handled;
  }

  private async check(attempt: AttemptRow, order: OrderRow) {
    if (order.status !== "pending" || attempt.state === "failed")
      return this.stop(attempt.id);
    if (!this.provider.configured)
      return this.later(attempt, "provider not configured", { count: false });
    let current = attempt;
    if (attempt.state === "requesting") {
      // Our own call never recorded an answer (the process stopped): unknown.
      const marked = await this.markUnknown(attempt);
      // Its call answered after we read the row and set the next check
      // itself; this stale row must not clear that schedule.
      if (!marked) return;
      current = marked;
    }
    try {
      if (current.state === "ready" && current.providerInvoiceId) {
        const invoice = await this.provider.getInvoice(
          current.providerInvoiceId,
        );
        if (!invoice)
          return this.later(current, "invoice not found", {
            issue: "invoice_missing",
          });
        return this.settle(current, order, invoice);
      }
      if (current.state === "unknown") return this.recover(current, order);
      return this.stop(current.id);
    } catch (error) {
      // Outage or rate limit: back off, keep the attempt (TC-PAY-10-04).
      return this.later(current, (error as Error).message);
    }
  }

  /** A finished invoice becomes a fact applied like a webhook (TC-PAY-10-01). */
  private async settle(
    attempt: AttemptRow,
    order: OrderRow,
    invoice: ProviderInvoice,
  ) {
    if (invoice.status !== "COMPLETED" && invoice.status !== "FAILED")
      return this.later(attempt, `invoice ${invoice.status.toLowerCase()}`);
    const fact = this.factOf(invoice, order);
    if (!fact)
      return this.later(attempt, "invoice without amount", {
        issue: "invoice_missing",
      });
    const eventId = await this.events.recordFact(
      fact,
      `reconcile:${invoice.id}:${invoice.status}`,
      { invoice },
    );
    if (eventId) await this.events.process(eventId);
    const [fresh] = await this.database.db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id));
    if (fresh?.status !== "pending") return this.stop(attempt.id);
    return this.later(attempt, "fact recorded, order still pending");
  }

  /**
   * The create call's answer was lost. The invoice is looked up by the
   * buyer email we sent, in a window from our request; it is taken over
   * only when exactly one unmapped invoice with our amount, currency and
   * type exists. Anything else stays unknown and goes to an operator.
   */
  private async recover(attempt: AttemptRow, order: OrderRow) {
    const now = this.clock.now();
    const requested = attempt.requestedAt.getTime();
    const invoices = await this.provider.findInvoices({
      buyerEmail: attempt.buyerEmail,
      from: new Date(requested - 2 * MINUTE_MS),
      to: new Date(Math.min(now.getTime(), requested + SEARCH_DAYS_MS)),
    });
    const expectedType =
      order.kind === "subscription" ? "SUBSCRIPTION_FIRST_INVOICE" : "INVOICE";
    const email = attempt.buyerEmail.toLowerCase();
    const candidates = invoices.filter(
      (invoice) =>
        invoice.currency === order.currency &&
        this.sameAmount(invoice.amount, order) &&
        (invoice.type === null || invoice.type === expectedType) &&
        (!invoice.buyerEmail || invoice.buyerEmail.toLowerCase() === email) &&
        // Not executed yet: its datetime is the creation time, near our request.
        (invoice.status === "COMPLETED" ||
          invoice.status === "FAILED" ||
          (invoice.datetime !== null &&
            Date.parse(invoice.datetime) <= requested + CREATED_WITHIN_MS)),
    );
    const ids = candidates.map((invoice) => invoice.id);
    const taken = ids.length
      ? await this.database.db
          .select({ id: checkoutAttempts.providerInvoiceId })
          .from(checkoutAttempts)
          .where(
            and(
              eq(checkoutAttempts.provider, this.provider.name),
              inArray(checkoutAttempts.providerInvoiceId, ids),
            ),
          )
      : [];
    const free = candidates.filter(
      (invoice) => !taken.some((t) => t.id === invoice.id),
    );
    const [only] = free;
    if (free.length !== 1 || !only)
      return this.later(
        attempt,
        free.length ? "several invoices could be ours" : "no matching invoice",
        {
          issue: "checkout_unknown",
          evidence: { candidateInvoiceIds: free.map((i) => i.id) },
        },
      );
    const mapped = await this.map(attempt, only.id);
    if (!mapped) return this.later(attempt, "invoice mapped elsewhere");
    this.logger.log(
      { attemptId: attempt.id, orderId: order.id },
      "Unknown checkout recovered",
    );
    await this.events.rematch(only.id);
    return this.settle(mapped, order, only);
  }

  private factOf(
    invoice: ProviderInvoice,
    order: OrderRow,
  ): PaymentFact | null {
    const failed = invoice.status === "FAILED";
    const currency = invoice.currency ?? (failed ? order.currency : null);
    const amount =
      invoice.amount ??
      (failed ? formatMinor(order.amountMinor, order.currency) : null);
    const at = invoice.datetime ? Date.parse(invoice.datetime) : Number.NaN;
    const parsed = paymentFactSchema.safeParse({
      kind: "payment",
      outcome: failed ? "failed" : "success",
      recurring: false,
      contractId: invoice.id,
      parentContractId: null,
      amount,
      currency,
      providerStatus: invoice.status,
      occurredAt: new Date(
        Number.isNaN(at) ? this.clock.now().getTime() : at,
      ).toISOString(),
      errorMessage: null,
    });
    return parsed.success ? parsed.data : null;
  }

  private sameAmount(amount: string | null, order: OrderRow) {
    if (amount === null) return false;
    try {
      return toMinor(amount, order.currency) === order.amountMinor;
    } catch (error) {
      if (error instanceof MoneyError) return false;
      throw error;
    }
  }

  private async markUnknown(attempt: AttemptRow) {
    const now = this.clock.now();
    const [row] = await this.database.db
      .update(checkoutAttempts)
      .set({
        state: "unknown",
        failureReason: "interrupted before the provider answered",
        updatedAt: now,
        version: sql`${checkoutAttempts.version} + 1`,
      })
      .where(
        and(
          eq(checkoutAttempts.id, attempt.id),
          eq(checkoutAttempts.state, "requesting"),
        ),
      )
      .returning();
    return row ?? null;
  }

  private async map(attempt: AttemptRow, invoiceId: string) {
    const now = this.clock.now();
    try {
      const [row] = await this.database.db
        .update(checkoutAttempts)
        .set({
          state: "ready",
          providerInvoiceId: invoiceId,
          failureReason: "recovered by reconciliation",
          resolvedAt: now,
          updatedAt: now,
          version: sql`${checkoutAttempts.version} + 1`,
        })
        .where(
          and(
            eq(checkoutAttempts.id, attempt.id),
            eq(checkoutAttempts.state, "unknown"),
          ),
        )
        .returning();
      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error, "checkout_attempts_invoice_uq")) return null;
      throw error;
    }
  }

  private async later(
    attempt: AttemptRow,
    reason: string,
    options: {
      issue?: IssueKind;
      evidence?: Record<string, unknown>;
      count?: boolean;
    } = {},
  ) {
    const now = this.clock.now();
    const checks =
      options.count === false ? attempt.checks : attempt.checks + 1;
    const delay =
      options.count === false
        ? CHECK_DELAYS_MS[5]
        : CHECK_DELAYS_MS[checks - 1];
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(checkoutAttempts)
        .set({
          checks,
          nextCheckAt:
            delay === undefined ? null : new Date(now.getTime() + delay),
          updatedAt: now,
        })
        .where(eq(checkoutAttempts.id, attempt.id));
      if (
        options.issue &&
        (checks >= ISSUE_AFTER_CHECKS || delay === undefined)
      ) {
        await this.issues.open(
          tx,
          {
            kind: options.issue,
            severity: "medium",
            subjectKey: `attempt:${attempt.id}`,
            related: { attemptId: attempt.id, orderId: attempt.orderId },
            evidence: { reason, checks, ...options.evidence },
          },
          now,
        );
      }
    });
    this.logger.log(
      { attemptId: attempt.id, checks, reason },
      "Checkout still open",
    );
  }

  private async stop(attemptId: string) {
    await this.database.db
      .update(checkoutAttempts)
      .set({ nextCheckAt: null, updatedAt: this.clock.now() })
      .where(eq(checkoutAttempts.id, attemptId));
  }
}
