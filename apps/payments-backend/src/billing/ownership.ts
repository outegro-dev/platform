import { and, eq, inArray, ne } from "drizzle-orm";
import type { Executor } from "../common/database.js";
import { customers, grants, subscriptions } from "../db/schema.js";
import type { ProductKind } from "../domain/catalog.js";
import { renewingStates } from "../domain/lifecycle.js";

export type Held = {
  /** "already owned" (one-time) or "already subscribed". */
  reason: string;
  orderId: string;
  subscriptionId: string | null;
};

/**
 * One buyer's purchases run one at a time: a checkout and the first payment
 * of an order take this row lock, so two at once cannot both miss what the
 * other has just created (a second invoice, a second grant).
 */
export async function lockBuyer(tx: Executor, userId: string) {
  await tx
    .select({ userId: customers.userId })
    .from(customers)
    .where(eq(customers.userId, userId))
    .for("update");
}

/**
 * What the buyer already has of a product: an active one-time purchase, or
 * a subscription Lava may still renew. `exceptOrderId` leaves out the order
 * that is being settled.
 */
export async function alreadyHeld(
  tx: Executor,
  userId: string,
  product: { key: string; kind: ProductKind; service: string; feature: string },
  exceptOrderId?: string,
): Promise<Held | null> {
  if (product.kind === "one_time") {
    const [owned] = await tx
      .select({ orderId: grants.sourceId })
      .from(grants)
      .where(
        and(
          eq(grants.userId, userId),
          eq(grants.service, product.service),
          eq(grants.feature, product.feature),
          eq(grants.sourceType, "purchase"),
          eq(grants.state, "active"),
          exceptOrderId ? ne(grants.sourceId, exceptOrderId) : undefined,
        ),
      );
    return owned
      ? {
          reason: "already owned",
          orderId: owned.orderId,
          subscriptionId: null,
        }
      : null;
  }
  const [live] = await tx
    .select({
      orderId: subscriptions.orderId,
      subscriptionId: subscriptions.id,
    })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.productKey, product.key),
        inArray(subscriptions.state, [...renewingStates]),
        exceptOrderId ? ne(subscriptions.orderId, exceptOrderId) : undefined,
      ),
    );
  return live ? { reason: "already subscribed", ...live } : null;
}
