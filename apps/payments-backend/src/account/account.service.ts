import { Inject, Injectable } from "@nestjs/common";
import { AppError, DATABASE } from "@outegro/nest-common";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { after, type Cursor, page } from "../common/cursor.js";
import type {
  GrantRow,
  OrderRow,
  PaymentsDatabase,
} from "../common/database.js";
import {
  checkoutAttempts,
  grants,
  orders,
  subscriptions,
} from "../db/schema.js";
import { orderView, subscriptionView } from "./views.js";

/**
 * Read models for the signed-in user. Ownership comes from the token only;
 * someone else's id looks exactly like a missing one (INV-10).
 */
@Injectable()
export class AccountService {
  constructor(@Inject(DATABASE) private readonly database: PaymentsDatabase) {}

  async orders(userId: string, cursor: Cursor | null, limit: number) {
    const rows = await this.database.db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.userId, userId),
          after(cursor, orders.createdAt, orders.id),
        ),
      )
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(limit + 1);
    const result = page(rows, limit, (row) => ({
      at: row.createdAt,
      id: row.id,
    }));
    return {
      items: await this.withDetails(result.items),
      nextCursor: result.nextCursor,
    };
  }

  async order(userId: string, orderId: string) {
    const [row] = await this.database.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    if (!row) throw new AppError("NOT_FOUND");
    const [view] = await this.withDetails([row]);
    return view;
  }

  async subscriptions(userId: string, cursor: Cursor | null, limit: number) {
    const rows = await this.database.db
      .select({ subscription: subscriptions, title: orders.title })
      .from(subscriptions)
      .innerJoin(orders, eq(orders.id, subscriptions.orderId))
      .where(
        and(
          eq(subscriptions.userId, userId),
          after(cursor, subscriptions.createdAt, subscriptions.id),
        ),
      )
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id))
      .limit(limit + 1);
    const result = page(rows, limit, (row) => ({
      at: row.subscription.createdAt,
      id: row.subscription.id,
    }));
    return {
      items: result.items.map((row) =>
        subscriptionView(row.subscription, row.title),
      ),
      nextCursor: result.nextCursor,
    };
  }

  async subscriptionTitle(subscriptionId: string) {
    const [row] = await this.database.db
      .select({ title: orders.title })
      .from(subscriptions)
      .innerJoin(orders, eq(orders.id, subscriptions.orderId))
      .where(eq(subscriptions.id, subscriptionId));
    return row?.title ?? null;
  }

  /** Attempt, subscription and access grant of each order, in three queries. */
  async withDetails(list: OrderRow[]) {
    if (!list.length) return [];
    const orderIds = list.map((order) => order.id);
    const attempts = await this.database.db
      .select()
      .from(checkoutAttempts)
      .where(inArray(checkoutAttempts.orderId, orderIds));
    const subs = await this.database.db
      .select({ id: subscriptions.id, orderId: subscriptions.orderId })
      .from(subscriptions)
      .where(inArray(subscriptions.orderId, orderIds));
    const subscriptionIds = subs.map((sub) => sub.id);
    const grantRows: GrantRow[] = await this.database.db
      .select()
      .from(grants)
      .where(
        or(
          and(
            eq(grants.sourceType, "purchase"),
            inArray(grants.sourceId, orderIds),
          ),
          subscriptionIds.length
            ? and(
                eq(grants.sourceType, "subscription"),
                inArray(grants.sourceId, subscriptionIds),
              )
            : undefined,
        ),
      );
    return list.map((order) => {
      const subscriptionId =
        subs.find((sub) => sub.orderId === order.id)?.id ?? null;
      const grant =
        grantRows.find(
          (g) =>
            (g.sourceType === "purchase" && g.sourceId === order.id) ||
            (g.sourceType === "subscription" && g.sourceId === subscriptionId),
        ) ?? null;
      return orderView(order, {
        attempt: attempts.find((a) => a.orderId === order.id) ?? null,
        subscriptionId,
        grant,
      });
    });
  }
}
