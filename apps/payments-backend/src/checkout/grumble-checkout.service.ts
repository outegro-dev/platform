import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq } from "drizzle-orm";
import { GrantLedger } from "../billing/grants.js";
import { alreadyHeld, lockBuyer } from "../billing/ownership.js";
import type {
  Executor,
  PaymentsDatabase,
  WalletOrderRow,
} from "../common/database.js";
import { grumblePacksConfig, grumblePricesConfig } from "../config/config.js";
import { products, walletOrders } from "../db/schema.js";
import { WalletClient } from "./wallet.client.js";

export type GrumbleCheckoutResult =
  | {
      status: "paid";
      orderId: string;
      productKey: string;
      grumbles: string;
      balanceAfter: string | null;
    }
  | {
      status: "short";
      productKey: string;
      grumbles: string;
      balance: string;
      shortfall: string;
      /** The smallest pack that covers the shortfall (or the largest one). */
      pack: { key: string; grumbles: string } | null;
    }
  | {
      status: "failed";
      orderId: string;
      productKey: string;
      grumbles: string;
      failure: string;
    };

/**
 * Purchases with grumbles (wallet phase 3, W-05). Payments leads them as
 * for money (ADR-011): an order, a debit in the wallet by `order:{id}`,
 * then the grant. A grant that cannot be given hands the grumbles back by
 * the same ref; a debit whose answer is lost is rolled back, or repeated
 * with the same Idempotency-Key, never made twice. No money moves: the
 * provider and the money journal never see these orders.
 */
@Injectable()
export class GrumbleCheckoutService {
  private readonly logger = new Logger("GrumbleCheckout");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(grumblePricesConfig.KEY)
    private readonly prices: ConfigType<typeof grumblePricesConfig>,
    @Inject(grumblePacksConfig.KEY)
    private readonly packs: ConfigType<typeof grumblePacksConfig>,
    private readonly wallet: WalletClient,
    private readonly grants: GrantLedger,
  ) {}

  /** A product's price in grumbles, while purchases with grumbles are on. */
  priceOf(productKey: string): bigint | null {
    if (!this.prices.enabled || !this.wallet.configured) return null;
    const price = this.prices.prices[productKey];
    return price === undefined ? null : BigInt(price);
  }

  async buy(
    userId: string,
    productKey: string,
    idempotencyKey: string,
    requestId: string | null,
  ): Promise<GrumbleCheckoutResult> {
    const existing = await this.find(userId, idempotencyKey);
    if (existing) return this.repeat(existing, productKey);

    const price = this.priceOf(productKey);
    const [product] = await this.database.db
      .select()
      .from(products)
      .where(and(eq(products.key, productKey), eq(products.active, true)));
    // Premium and packs are not for grumbles: one-time products only.
    if (price === null || product?.kind !== "one_time")
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { productKey: ["not sold for grumbles"] },
      });

    // Not enough is an answer, not an order: the buyer tops up and comes back.
    const balance = await this.wallet.balance(userId);
    if (balance === null) throw new AppError("DEPENDENCY_UNAVAILABLE");
    if (balance < price) return this.short(productKey, price, balance);

    const now = this.clock.now();
    const order = await this.database.db.transaction(async (tx) => {
      await lockBuyer(tx, userId);
      const repeat = await this.find(userId, idempotencyKey, tx);
      if (repeat) return repeat;
      const held = await alreadyHeld(tx, userId, product);
      if (held)
        throw new AppError("ALREADY_OWNED", {
          fieldErrors: { productKey: [held.reason] },
        });
      // A second click while the first is being paid for: the same order.
      const [open] = await tx
        .select()
        .from(walletOrders)
        .where(
          and(
            eq(walletOrders.userId, userId),
            eq(walletOrders.productKey, productKey),
            eq(walletOrders.status, "pending"),
          ),
        );
      if (open) return open;
      const [row] = await tx
        .insert(walletOrders)
        .values({
          userId,
          productKey,
          service: product.service,
          feature: product.feature,
          title: product.title,
          grumbles: price,
          idempotencyKey,
          fingerprint: productKey,
          correlationId: requestId ?? idempotencyKey,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!row) throw new Error("wallet order insert returned nothing");
      return row;
    });
    return this.repeat(order, productKey);
  }

  /** The same key again: its order as it stands, finished if left half-way. */
  private repeat(order: WalletOrderRow, productKey: string) {
    if (order.fingerprint !== productKey)
      throw new AppError("IDEMPOTENCY_CONFLICT", {
        fieldErrors: { "Idempotency-Key": ["used for another purchase"] },
      });
    return order.status === "pending"
      ? this.complete(order)
      : Promise.resolve(this.result(order));
  }

  /** Debit by the order's ref, then the grant in one transaction. */
  private async complete(
    order: WalletOrderRow,
  ): Promise<GrumbleCheckoutResult> {
    const ref = `order:${order.id}`;
    const debit = await this.wallet.debit({
      ref,
      userId: order.userId,
      amount: order.grumbles,
      source: order.service === "battleship" ? "battleship-shop" : "pay",
      objectRef: ref,
      reason: order.title.en,
      meta: { productKey: order.productKey },
      correlationId: order.correlationId,
    });
    switch (debit.kind) {
      case "insufficient_funds": {
        await this.fail(order, "insufficient_funds");
        const balance = (await this.wallet.balance(order.userId)) ?? 0n;
        return this.short(order.productKey, order.grumbles, balance);
      }
      case "restricted":
        await this.fail(order, "restricted");
        throw new AppError("WALLET_RESTRICTED");
      case "rolled_back":
        return this.result(await this.fail(order, "wallet_unavailable"));
      case "unknown": {
        this.logger.warn(
          { orderId: order.id, why: debit.why },
          "Debit unknown",
        );
        // It may have gone through: the same ref is undone, or the order
        // stays pending and the same key finishes it later.
        if (
          await this.wallet.rollback(
            ref,
            "purchase not confirmed",
            order.correlationId,
          )
        )
          await this.fail(order, "wallet_unavailable");
        throw new AppError("DEPENDENCY_UNAVAILABLE");
      }
    }

    let granted: WalletOrderRow | "held";
    try {
      granted = await this.database.db.transaction((tx) =>
        this.grant(tx, order, debit.balanceAfter),
      );
    } catch (error) {
      // TC-W-05-03: no grant, so the grumbles go back by the same ref.
      if (await this.wallet.rollback(ref, "grant failed", order.correlationId))
        await this.fail(order, "grant_failed");
      throw error;
    }
    if (granted === "held") {
      // Bought meanwhile another way (with money): nothing is taken twice.
      if (await this.wallet.rollback(ref, "already owned", order.correlationId))
        await this.fail(order, "already_owned");
      throw new AppError("ALREADY_OWNED", {
        fieldErrors: { productKey: ["already owned"] },
      });
    }
    this.logger.log({ orderId: order.id }, "Bought with grumbles");
    return this.result(granted);
  }

  private async grant(
    tx: Executor,
    order: WalletOrderRow,
    balanceAfter: bigint,
  ): Promise<WalletOrderRow | "held"> {
    await lockBuyer(tx, order.userId);
    const [current] = await tx
      .select()
      .from(walletOrders)
      .where(eq(walletOrders.id, order.id))
      .for("update");
    if (!current) throw new Error("wallet order disappeared");
    if (current.status !== "pending") return current;
    const product = {
      key: order.productKey,
      kind: "one_time" as const,
      service: order.service,
      feature: order.feature,
    };
    if (await alreadyHeld(tx, order.userId, product, order.id)) return "held";
    const now = this.clock.now();
    await this.grants.activate(
      tx,
      {
        userId: order.userId,
        service: order.service,
        feature: order.feature,
        sourceType: "purchase",
        sourceId: order.id,
      },
      { validFrom: now, validUntil: null },
      now,
      order.correlationId,
    );
    const [paid] = await tx
      .update(walletOrders)
      .set({ status: "paid", paidAt: now, balanceAfter, updatedAt: now })
      .where(eq(walletOrders.id, order.id))
      .returning();
    if (!paid) throw new Error("wallet order disappeared");
    return paid;
  }

  private async fail(order: WalletOrderRow, failure: string) {
    const [failed] = await this.database.db
      .update(walletOrders)
      .set({ status: "failed", failure, updatedAt: this.clock.now() })
      .where(
        and(eq(walletOrders.id, order.id), eq(walletOrders.status, "pending")),
      )
      .returning();
    return failed ?? order;
  }

  private short(
    productKey: string,
    price: bigint,
    balance: bigint,
  ): GrumbleCheckoutResult {
    const shortfall = price - balance;
    const packs = this.packs.enabled
      ? [...this.packs.packs].sort((a, b) => a.grumbles - b.grumbles)
      : [];
    const pack =
      packs.find((p) => BigInt(p.grumbles) >= shortfall) ?? packs.at(-1);
    return {
      status: "short",
      productKey,
      grumbles: price.toString(),
      balance: balance.toString(),
      shortfall: shortfall.toString(),
      pack: pack ? { key: pack.key, grumbles: String(pack.grumbles) } : null,
    };
  }

  private result(order: WalletOrderRow): GrumbleCheckoutResult {
    const common = {
      orderId: order.id,
      productKey: order.productKey,
      grumbles: order.grumbles.toString(),
    };
    return order.status === "paid"
      ? {
          status: "paid",
          ...common,
          balanceAfter: order.balanceAfter?.toString() ?? null,
        }
      : { status: "failed", ...common, failure: order.failure ?? "unknown" };
  }

  private async find(
    userId: string,
    key: string,
    tx: Executor = this.database.db,
  ) {
    const [row] = await tx
      .select()
      .from(walletOrders)
      .where(
        and(
          eq(walletOrders.userId, userId),
          eq(walletOrders.idempotencyKey, key),
        ),
      );
    return row;
  }
}
