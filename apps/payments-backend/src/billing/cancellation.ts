import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { type Actor, audit } from "../common/audit.js";
import type {
  Executor,
  PaymentsDatabase,
  SubscriptionRow,
} from "../common/database.js";
import {
  grants,
  payments,
  providerEvents,
  subscriptions,
} from "../db/schema.js";
import type { CancellationFact } from "../domain/facts.js";
import { subscriptionLifecycle } from "../domain/lifecycle.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  ProviderRejectedError,
} from "../lava/provider.js";
import { type IssueKind, IssueRegistry } from "./issues.js";
import { subscriptionChanged } from "./outbox-events.js";
import type { Outcome } from "./outcome.js";

const PROVIDER = "lava";
/** Retries of an unanswered cancel call: 1 min, 5 min, 15 min, 1 h, 6 h. */
const FIRST_RETRY_MS = 60_000;
const RETRY_DELAYS_MS = [
  FIRST_RETRY_MS,
  300_000,
  900_000,
  3_600_000,
  21_600_000,
];
const DAY_MS = 86_400_000;

/**
 * Turning renewal off (chapter 6.7, PAY-08). Cancel is not a refund: paid
 * time is kept. The provider call happens outside any transaction; until it
 * is confirmed the subscription stays `cancel_requested` and is retried.
 * Revoking a subscription's grant turns renewal off the same way.
 */
@Injectable()
export class CancellationService {
  private readonly logger = new Logger("Cancellation");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly issues: IssueRegistry,
    private readonly relay: OutboxRelay,
  ) {}

  /**
   * Cancel command from the owner (`ownerId`) or an operator (`reason`).
   * Repeating it has no new effect, except that an operator can send the
   * call again while Lava has not confirmed (the retry path of a failed
   * cancel); someone else's subscription is 404.
   */
  async cancel(
    subscriptionId: string,
    input: { ownerId?: string; operator?: { actor: Actor; reason: string } },
  ): Promise<SubscriptionRow> {
    const now = this.clock.now();
    const { row, call } = await this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.id, subscriptionId),
            input.ownerId ? eq(subscriptions.userId, input.ownerId) : undefined,
          ),
        )
        .for("update");
      if (!current) throw new AppError("NOT_FOUND");
      if (input.operator) {
        await audit(tx, {
          actor: input.operator.actor,
          action: "subscription.cancel",
          targetType: "subscription",
          targetId: current.id,
          reason: input.operator.reason,
          data: { state: current.state },
          at: now,
        });
      }
      const next = subscriptionLifecycle.cancelRequested(current.state);
      const again = !next && input.operator !== undefined && current.autoRenew;
      if (!next && !again) return { row: current, call: false };
      const updated = await this.request(
        tx,
        current,
        next ?? current.state,
        now,
      );
      return { row: updated, call: true };
    });
    this.relay.kick();
    if (!call) return row;
    return this.callProvider(row);
  }

  /**
   * Access of this subscription was revoked: Lava must stop charging for it.
   * Runs in the revoke's transaction and returns the subscription whose call
   * is to be sent after the commit (callProvider), or null when renewal is
   * already off.
   */
  async stopRenewal(tx: Executor, subscriptionId: string, now: Date) {
    const current = await this.lock(tx, subscriptionId);
    if (!current.autoRenew) return null;
    return this.request(
      tx,
      current,
      subscriptionLifecycle.cancelRequested(current.state) ?? current.state,
      now,
    );
  }

  /** Records the request; if this process dies before the provider answers, the worker retries. */
  private async request(
    tx: Executor,
    current: SubscriptionRow,
    state: SubscriptionRow["state"],
    now: Date,
  ) {
    const changed = state !== current.state;
    const [updated] = await tx
      .update(subscriptions)
      .set({
        state,
        cancelRequestedAt: now,
        cancelAttempts: 0,
        nextCancelAttemptAt: new Date(now.getTime() + FIRST_RETRY_MS),
        updatedAt: now,
        ...(changed ? { version: sql`${subscriptions.version} + 1` } : {}),
      })
      .where(eq(subscriptions.id, current.id))
      .returning();
    if (!updated) throw new Error("subscription disappeared");
    if (changed) await subscriptionChanged(tx, updated, now);
    return updated;
  }

  /**
   * Worker: retries cancel calls whose outcome is still unknown, also after
   * the paid time ran out (expired) or a later payment revived the
   * subscription: until Lava confirms, it may charge the next period.
   */
  async retryDue(limit = 20) {
    const now = this.clock.now();
    const due = await this.database.db
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.autoRenew, true),
          isNotNull(subscriptions.nextCancelAttemptAt),
          lte(subscriptions.nextCancelAttemptAt, now),
        ),
      )
      .limit(limit);
    for (const subscription of due) await this.callProvider(subscription);
    return due.length;
  }

  /** The cancel call, outside any transaction: confirmed, refused, or retried later. */
  async callProvider(subscription: SubscriptionRow) {
    try {
      const result = await this.provider.cancelSubscription({
        parentContractId: subscription.providerParentContractId,
        email: subscription.buyerEmail,
      });
      if (result === "cancelled") return await this.confirmed(subscription.id);
      return await this.problem(
        subscription.id,
        "provider has no such subscription",
      );
    } catch (error) {
      if (error instanceof ProviderRejectedError)
        return await this.problem(subscription.id, error.reason);
      return await this.retryLater(subscription.id, (error as Error).message);
    }
  }

  /** The provider confirmed (HTTP answer or subscription.cancelled webhook). */
  private async confirmed(subscriptionId: string) {
    const now = this.clock.now();
    const row = await this.database.db.transaction(async (tx) => {
      const current = await this.lock(tx, subscriptionId);
      return this.markCancelled(
        tx,
        current,
        { cancelledAt: now, willExpireAt: null },
        now,
      );
    });
    this.relay.kick();
    this.logger.log({ subscriptionId }, "Renewal cancelled at the provider");
    return row;
  }

  /** A definite refusal: keep paid access, stop retrying, tell an operator. */
  private async problem(subscriptionId: string, reason: string) {
    const now = this.clock.now();
    const row = await this.database.db.transaction(async (tx) => {
      const current = await this.lock(tx, subscriptionId);
      await this.issues.open(
        tx,
        {
          kind: await this.failureKind(tx, subscriptionId),
          severity: "high",
          subjectKey: `cancel:${subscriptionId}`,
          related: { subscriptionId },
          evidence: { reason },
        },
        now,
      );
      const [updated] = await tx
        .update(subscriptions)
        .set({ nextCancelAttemptAt: null, updatedAt: now })
        .where(eq(subscriptions.id, current.id))
        .returning();
      return updated ?? current;
    });
    this.logger.warn({ subscriptionId, reason }, "Cancellation refused");
    return row;
  }

  /** Unknown outcome (timeout, 5xx): retry with backoff, then hand over (TC-PAY-08-04). */
  private async retryLater(subscriptionId: string, reason: string) {
    const now = this.clock.now();
    return this.database.db.transaction(async (tx) => {
      const current = await this.lock(tx, subscriptionId);
      // attempts counts failed calls: after the first one, wait the first delay.
      const attempts = current.cancelAttempts + 1;
      const delay = RETRY_DELAYS_MS[attempts - 1];
      const next = delay === undefined ? null : new Date(now.getTime() + delay);
      const kind = await this.failureKind(tx, subscriptionId);
      // Revoked access is charged for nothing: the operator hears at once.
      if (delay === undefined || kind === "renewal_cancel_failed") {
        await this.issues.open(
          tx,
          {
            kind,
            severity: "high",
            subjectKey: `cancel:${subscriptionId}`,
            related: { subscriptionId },
            evidence: {
              reason,
              attempts,
              nextAttemptAt: next?.toISOString() ?? null,
            },
          },
          now,
        );
      }
      const [updated] = await tx
        .update(subscriptions)
        .set({
          cancelAttempts: attempts,
          nextCancelAttemptAt: next,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, current.id))
        .returning();
      this.logger.warn(
        { subscriptionId, attempts, reason },
        "Cancel call failed",
      );
      return updated ?? current;
    });
  }

  /** subscription.cancelled from the provider. */
  async applyProviderCancellation(
    tx: Executor,
    fact: CancellationFact,
  ): Promise<Outcome> {
    const now = this.clock.now();
    const subscriptionId = await this.findByContract(tx, fact.contractId);
    if (!subscriptionId)
      return { status: "unmatched", note: "no subscription for this contract" };
    const current = await this.lock(tx, subscriptionId);
    const ids = { orderId: current.orderId, subscriptionId: current.id };
    if (!current.autoRenew && current.state !== "cancel_requested")
      return { status: "ignored", note: "renewal already off", ...ids };
    await this.markCancelled(
      tx,
      current,
      {
        cancelledAt: fact.cancelledAt ? new Date(fact.cancelledAt) : now,
        willExpireAt: fact.willExpireAt ? new Date(fact.willExpireAt) : null,
      },
      now,
    );
    return { status: "processed", note: "renewal cancelled", ...ids };
  }

  private async markCancelled(
    tx: Executor,
    current: SubscriptionRow,
    input: { cancelledAt: Date; willExpireAt: Date | null },
    now: Date,
  ) {
    if (!current.autoRenew && current.state !== "cancel_requested")
      return current;
    const next =
      subscriptionLifecycle.cancelled(current.state) ?? current.state;
    const [updated] = await tx
      .update(subscriptions)
      .set({
        state: next,
        autoRenew: false,
        cancelledAt: current.cancelledAt ?? input.cancelledAt,
        providerExpiresAt: input.willExpireAt ?? current.providerExpiresAt,
        nextCancelAttemptAt: null,
        updatedAt: now,
        version: sql`${subscriptions.version} + 1`,
      })
      .where(eq(subscriptions.id, current.id))
      .returning();
    if (!updated) throw new Error("subscription disappeared");
    await subscriptionChanged(tx, updated, now);
    // Renewal is off at Lava: a failed cancel needs no operator any more.
    await this.issues.resolve(
      tx,
      `cancel:${updated.id}`,
      { actorId: null, resolution: "renewal cancelled at the provider" },
      now,
    );
    // Our paid end is kept; a provider date far from it goes to an operator.
    if (
      input.willExpireAt &&
      Math.abs(input.willExpireAt.getTime() - updated.paidUntil.getTime()) >
        DAY_MS
    ) {
      await this.issues.open(
        tx,
        {
          kind: "period_mismatch",
          severity: "low",
          subjectKey: `period:${updated.id}`,
          related: { subscriptionId: updated.id },
          evidence: {
            paidUntil: updated.paidUntil.toISOString(),
            providerExpiresAt: input.willExpireAt.toISOString(),
          },
        },
        now,
      );
    }
    return updated;
  }

  /**
   * The cancellation event may name the parent contract or a later renewal
   * contract (both appear in the documented examples).
   */
  private async findByContract(tx: Executor, contractId: string) {
    const [byParent] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, PROVIDER),
          eq(subscriptions.providerParentContractId, contractId),
        ),
      );
    if (byParent) return byParent.id;
    const [byPayment] = await tx
      .select({ id: payments.subscriptionId })
      .from(payments)
      .where(
        and(
          eq(payments.provider, PROVIDER),
          eq(payments.providerContractId, contractId),
        ),
      );
    if (byPayment?.id) return byPayment.id;
    const [byEvent] = await tx
      .select({ parent: providerEvents.parentContractId })
      .from(providerEvents)
      .where(
        and(
          eq(providerEvents.provider, PROVIDER),
          eq(providerEvents.contractId, contractId),
          isNotNull(providerEvents.parentContractId),
        ),
      )
      .limit(1);
    if (!byEvent?.parent) return null;
    const [byRenewal] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.provider, PROVIDER),
          eq(subscriptions.providerParentContractId, byEvent.parent),
        ),
      );
    return byRenewal?.id ?? null;
  }

  private async lock(tx: Executor, subscriptionId: string) {
    const [row] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId))
      .for("update");
    if (!row) throw new Error("subscription disappeared");
    return row;
  }

  /**
   * A cancel that fails after the access was revoked (by an operator, or a
   * duplicate purchase) is its own kind: Lava may charge for nothing.
   */
  private async failureKind(
    tx: Executor,
    subscriptionId: string,
  ): Promise<IssueKind> {
    const [grant] = await tx
      .select({ state: grants.state })
      .from(grants)
      .where(
        and(
          eq(grants.sourceType, "subscription"),
          eq(grants.sourceId, subscriptionId),
        ),
      );
    return grant?.state === "revoked"
      ? "renewal_cancel_failed"
      : "cancel_failed";
  }
}
