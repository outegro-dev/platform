import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alreadyHeld, lockBuyer } from "../billing/ownership.js";
import { ProviderEvents } from "../billing/provider-events.js";
import { CatalogService, type Offer } from "../catalog/catalog.service.js";
import type {
  AttemptRow,
  Executor,
  OrderRow,
  PaymentsDatabase,
} from "../common/database.js";
import { checkoutConfig, lavaConfig } from "../config/config.js";
import { CustomersService } from "../customers/customers.service.js";
import { checkoutAttempts, orders } from "../db/schema.js";
import type { Currency } from "../domain/money.js";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  ProviderRejectedError,
  ProviderUnavailableError,
} from "../lava/provider.js";

export type CheckoutInput = {
  productKey: string;
  currency: Currency;
  returnUrl?: string | undefined;
};

export type CheckoutResult = {
  orderId: string;
  attemptId: string;
  /** requesting | ready | failed | unknown */
  state: AttemptRow["state"];
  /** Order status: pending until the provider confirms the payment. */
  status: OrderRow["status"];
  paymentUrl: string | null;
};

/** First reconciliation look at a fresh attempt. */
const FIRST_CHECK_MS = 60_000;
/**
 * An unpaid payment page is offered again for this long (engineering
 * default: Lava documents no invoice lifetime; one it fails ends sooner).
 */
const REUSE_FOR_MS = 60 * 60_000;

class DuplicateCommand extends Error {}

type Found = { attempt: AttemptRow; order: OrderRow };
type Begun =
  | { kind: "repeat"; found: Found }
  | { kind: "open"; found: Found }
  | { kind: "created"; attempt: AttemptRow };

/**
 * Checkout (PAY-03, recipe checkout-implementation): order and attempt are
 * committed before the network; exactly one caller talks to the provider;
 * a lost answer leaves the attempt `unknown` for reconciliation, never a
 * second invoice (INV-16). Price and buyer come from the server only. A
 * buyer's unpaid checkout of the same product and currency is returned
 * instead of a new one, whatever the key (QA H1).
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger("Checkout");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(checkoutConfig.KEY)
    private readonly config: ConfigType<typeof checkoutConfig>,
    @Inject(lavaConfig.KEY)
    private readonly lava: ConfigType<typeof lavaConfig>,
    private readonly catalog: CatalogService,
    private readonly customers: CustomersService,
    private readonly events: ProviderEvents,
  ) {}

  async start(
    userId: string,
    input: CheckoutInput,
    idempotencyKey: string,
    requestId: string | null,
  ): Promise<CheckoutResult> {
    const fingerprint = this.fingerprint(input);
    // A repeated command returns the logical result it already has.
    const existing = await this.find(userId, idempotencyKey);
    if (existing) return this.replay(existing, fingerprint);

    if (!this.config.enabled || !this.provider.configured)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { checkout: ["sales are closed"] },
      });
    const offer = await this.catalog.offer(input.productKey, input.currency);
    const buyer = await this.customers.forCheckout(userId);
    const returnUrl = this.returnUrl(input.returnUrl);

    const now = this.clock.now();
    const orderId = randomUUID();
    let begun: Begun;
    try {
      begun = await this.database.db.transaction(async (tx): Promise<Begun> => {
        await lockBuyer(tx, userId);
        // The same key may have held the lock just before us.
        const repeat = await this.find(userId, idempotencyKey, tx);
        if (repeat) return { kind: "repeat", found: repeat };
        await this.assertNotOwned(tx, userId, offer);
        const open = await this.openAttempt(tx, userId, offer, now);
        if (open) return { kind: "open", found: open };
        await tx.insert(orders).values({
          id: orderId,
          userId,
          productKey: offer.product.key,
          priceId: offer.price.id,
          priceVersion: offer.price.version,
          kind: offer.product.kind,
          service: offer.product.service,
          feature: offer.product.feature,
          periodicity: offer.product.periodicity,
          graceDays: offer.product.graceDays,
          providerOfferId: offer.product.providerOfferId,
          title: offer.product.title,
          currency: offer.price.currency,
          amountMinor: offer.price.amountMinor,
          correlationId: requestId ?? orderId,
          createdAt: now,
          updatedAt: now,
        });
        const [row] = await tx
          .insert(checkoutAttempts)
          .values({
            orderId,
            userId,
            idempotencyKey,
            fingerprint,
            state: "requesting",
            provider: this.provider.name,
            buyerEmail: buyer.email,
            buyerLanguage: buyer.locale === "ru" ? "RU" : "EN",
            returnUrl,
            requestedAt: now,
            // A crash during the provider call is picked up as unknown.
            nextCheckAt: new Date(now.getTime() + this.staleAfterMs()),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing({
            target: [checkoutAttempts.userId, checkoutAttempts.idempotencyKey],
          })
          .returning();
        // Another request with this key won the race: drop our order.
        if (!row) throw new DuplicateCommand();
        return { kind: "created", attempt: row };
      });
    } catch (error) {
      if (error instanceof DuplicateCommand) {
        const winner = await this.find(userId, idempotencyKey);
        if (winner) return this.replay(winner, fingerprint);
      }
      throw error;
    }
    if (begun.kind === "repeat") return this.replay(begun.found, fingerprint);
    if (begun.kind === "open") {
      this.logger.log(
        { orderId: begun.found.order.id, attemptId: begun.found.attempt.id },
        "Open checkout returned instead of a new invoice",
      );
      return this.toResult(begun.found);
    }
    return this.request(begun.attempt, offer);
  }

  /** The single provider call of this attempt, outside any transaction. */
  private async request(attempt: AttemptRow, offer: Offer) {
    const log = { orderId: attempt.orderId, attemptId: attempt.id };
    try {
      const created = await this.provider.createInvoice({
        email: attempt.buyerEmail,
        offerId: offer.product.providerOfferId,
        currency: offer.price.currency,
        periodicity: offer.product.periodicity,
        buyerLanguage: attempt.buyerLanguage === "RU" ? "RU" : "EN",
        returnUrls: this.returnUrls(attempt.returnUrl, attempt.orderId),
      });
      const now = this.clock.now();
      await this.resolve(attempt.id, {
        state: "ready",
        providerInvoiceId: created.invoiceId,
        paymentUrl: created.paymentUrl,
        nextCheckAt: new Date(now.getTime() + FIRST_CHECK_MS),
      });
      this.logger.log({ ...log, outcome: "ready" }, "Invoice created");
      // A webhook may have arrived before we knew the invoice id.
      await this.events.rematch(created.invoiceId);
    } catch (error) {
      if (
        error instanceof ProviderRejectedError ||
        (error instanceof ProviderUnavailableError && !error.maybeSent)
      ) {
        await this.resolve(attempt.id, {
          state: "failed",
          failureReason: error.message,
          providerInvoiceId:
            error instanceof ProviderRejectedError ? error.invoiceId : null,
          nextCheckAt: null,
        });
        this.logger.warn(
          { ...log, outcome: "failed", reason: error.message },
          "Invoice refused",
        );
      } else {
        const now = this.clock.now();
        await this.resolve(attempt.id, {
          state: "unknown",
          failureReason: (error as Error).message ?? "unknown",
          nextCheckAt: new Date(now.getTime() + FIRST_CHECK_MS),
        });
        this.logger.warn(
          { ...log, outcome: "unknown", reason: (error as Error).message },
          "Invoice outcome unknown; reconciliation will check",
        );
      }
    }
    const current = await this.find(attempt.userId, attempt.idempotencyKey);
    if (!current) throw new Error("attempt disappeared");
    return this.toResult(current);
  }

  /** Records the provider answer while the attempt is still ours to resolve. */
  private async resolve(
    attemptId: string,
    set: {
      state: "ready" | "failed" | "unknown";
      providerInvoiceId?: string | null;
      paymentUrl?: string;
      failureReason?: string;
      nextCheckAt: Date | null;
    },
  ) {
    const now = this.clock.now();
    await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(checkoutAttempts)
        .set({
          ...set,
          resolvedAt: set.state === "unknown" ? null : now,
          updatedAt: now,
          version: sql`${checkoutAttempts.version} + 1`,
        })
        .where(
          and(
            eq(checkoutAttempts.id, attemptId),
            // A definite answer still counts if reconciliation already gave
            // up waiting for it; an unknown one never overwrites anything.
            set.state === "unknown"
              ? eq(checkoutAttempts.state, "requesting")
              : inArray(checkoutAttempts.state, ["requesting", "unknown"]),
          ),
        )
        .returning();
      if (row && set.state === "failed") {
        await tx
          .update(orders)
          .set({
            status: "failed",
            updatedAt: now,
            version: sql`${orders.version} + 1`,
          })
          .where(and(eq(orders.id, row.orderId), eq(orders.status, "pending")));
      }
    });
  }

  private async find(
    userId: string,
    idempotencyKey: string,
    tx: Executor = this.database.db,
  ) {
    const [row] = await tx
      .select({ attempt: checkoutAttempts, order: orders })
      .from(checkoutAttempts)
      .innerJoin(orders, eq(orders.id, checkoutAttempts.orderId))
      .where(
        and(
          eq(checkoutAttempts.userId, userId),
          eq(checkoutAttempts.idempotencyKey, idempotencyKey),
        ),
      );
    return row ?? null;
  }

  private replay(existing: Found, fingerprint: string) {
    if (existing.attempt.fingerprint !== fingerprint)
      throw new AppError("IDEMPOTENCY_CONFLICT");
    return this.toResult(existing);
  }

  private toResult({ attempt, order }: Found) {
    return {
      orderId: order.id,
      attemptId: attempt.id,
      state: attempt.state,
      status: order.status,
      paymentUrl:
        attempt.state === "ready" && order.status === "pending"
          ? attempt.paymentUrl
          : null,
    } satisfies CheckoutResult;
  }

  /** Canonical input of the command (not raw JSON), scoped by user and key. */
  private fingerprint(input: CheckoutInput) {
    return createHash("sha256")
      .update(
        JSON.stringify([
          "checkout",
          input.productKey,
          input.currency,
          input.returnUrl ?? null,
        ]),
      )
      .digest("hex");
  }

  /** A second copy of something owned, or a second live subscription, is refused. */
  private async assertNotOwned(tx: Executor, userId: string, offer: Offer) {
    const held = await alreadyHeld(tx, userId, offer.product);
    if (held)
      throw new AppError("ALREADY_OWNED", {
        fieldErrors: { productKey: [held.reason] },
      });
  }

  /**
   * The buyer's unpaid checkout of this product and currency: its provider
   * call is still running, or its payment page can still be paid. Whatever
   * the key, it is the same purchase, so it gets no second invoice.
   */
  private async openAttempt(
    tx: Executor,
    userId: string,
    offer: Offer,
    now: Date,
  ): Promise<Found | null> {
    const since = (ms: number) => new Date(now.getTime() - ms);
    const [open] = await tx
      .select({ attempt: checkoutAttempts, order: orders })
      .from(checkoutAttempts)
      .innerJoin(orders, eq(orders.id, checkoutAttempts.orderId))
      .where(
        and(
          eq(orders.userId, userId),
          eq(orders.productKey, offer.product.key),
          eq(orders.currency, offer.price.currency),
          eq(orders.status, "pending"),
          or(
            and(
              eq(checkoutAttempts.state, "requesting"),
              gt(checkoutAttempts.requestedAt, since(this.staleAfterMs())),
            ),
            and(
              eq(checkoutAttempts.state, "ready"),
              isNotNull(checkoutAttempts.paymentUrl),
              gt(checkoutAttempts.requestedAt, since(REUSE_FOR_MS)),
            ),
          ),
        ),
      )
      .orderBy(desc(checkoutAttempts.requestedAt))
      .limit(1);
    return open ?? null;
  }

  /** Only our own origins: the return page must not become an open redirect. */
  private returnUrl(requested: string | undefined) {
    if (!requested) return this.config.defaultReturnUrl;
    let url: URL;
    try {
      url = new URL(requested);
    } catch {
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { returnUrl: ["invalid url"] },
      });
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !this.config.returnOrigins.includes(url.origin)
    )
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { returnUrl: ["origin not allowed"] },
      });
    url.hash = "";
    return url.toString();
  }

  /** The return page learns which order to poll; its `result` is only a hint (INV-17). */
  private returnUrls(base: string, orderId: string) {
    const make = (result: string) => {
      const url = new URL(base);
      url.searchParams.set("orderId", orderId);
      url.searchParams.set("result", result);
      return url.toString();
    };
    return {
      success: make("success"),
      failure: make("failure"),
      cancel: make("cancel"),
    };
  }

  private staleAfterMs() {
    return this.lava.timeoutMs * 2 + 30_000;
  }
}
