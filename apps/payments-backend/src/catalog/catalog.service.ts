import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  heldBySafeMode,
} from "@outegro/nest-common";
import { and, asc, eq, isNull, max, notInArray, sql } from "drizzle-orm";
import type { PaymentsDatabase } from "../common/database.js";
import { prices, products } from "../db/schema.js";
import { type CatalogProduct, catalog } from "../domain/catalog.js";
import {
  type Currency,
  isCurrency,
  moneyDto,
  toMinor,
} from "../domain/money.js";

export type Offer = {
  product: typeof products.$inferSelect;
  price: typeof prices.$inferSelect;
};

/**
 * The catalog lives in code (`domain/catalog.ts`) and is synced into the
 * database at startup. A changed amount closes the current price version
 * and opens the next one; orders keep the version they were created with.
 */
@Injectable()
export class CatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Catalog");

  constructor(
    @Inject(DATABASE) private readonly database: PaymentsDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap() {
    // A restored catalog stays as it was until the operator is done.
    if (heldBySafeMode("catalog sync")) return;
    await this.sync(catalog);
  }

  async sync(definition: readonly CatalogProduct[]) {
    const now = this.clock.now();
    let versions = 0;
    await this.database.db.transaction(async (tx) => {
      // One writer at a time, also during a rolling restart.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('payments.catalog'))`,
      );
      for (const product of definition) {
        const fields = {
          service: product.service,
          feature: product.feature,
          kind: product.kind,
          periodicity: product.periodicity,
          provider: product.provider,
          providerOfferId: product.providerOfferId,
          graceDays: product.graceDays,
          title: product.title,
          description: product.description,
          active: true,
          updatedAt: now,
        };
        await tx
          .insert(products)
          .values({ key: product.key, ...fields, createdAt: now })
          .onConflictDoUpdate({ target: products.key, set: fields });
        const current = await tx
          .select()
          .from(prices)
          .where(
            and(eq(prices.productKey, product.key), isNull(prices.validUntil)),
          )
          .for("update");
        for (const [currency, decimal] of Object.entries(product.prices)) {
          if (!isCurrency(currency) || decimal === undefined) continue;
          const amountMinor = toMinor(decimal, currency);
          const row = current.find((price) => price.currency === currency);
          if (row?.amountMinor === amountMinor) continue;
          if (row)
            await tx
              .update(prices)
              .set({ validUntil: now })
              .where(eq(prices.id, row.id));
          const [last] = await tx
            .select({ version: max(prices.version) })
            .from(prices)
            .where(
              and(
                eq(prices.productKey, product.key),
                eq(prices.currency, currency),
              ),
            );
          await tx.insert(prices).values({
            productKey: product.key,
            currency,
            amountMinor,
            version: (last?.version ?? 0) + 1,
            validFrom: now,
          });
          versions++;
        }
        for (const row of current) {
          if (!(row.currency in product.prices))
            await tx
              .update(prices)
              .set({ validUntil: now })
              .where(eq(prices.id, row.id));
        }
      }
      const keys = definition.map((product) => product.key);
      await tx
        .update(products)
        .set({ active: false, updatedAt: now })
        .where(keys.length ? notInArray(products.key, keys) : undefined);
    });
    if (versions) this.logger.log({ versions }, "Catalog prices updated");
  }

  /** Active products with their current prices. */
  async list() {
    const rows = await this.database.db
      .select({ product: products, price: prices })
      .from(products)
      .innerJoin(
        prices,
        and(eq(prices.productKey, products.key), isNull(prices.validUntil)),
      )
      .where(eq(products.active, true))
      .orderBy(asc(products.key), asc(prices.currency));
    const byKey = new Map<
      string,
      { product: Offer["product"]; prices: Offer["price"][] }
    >();
    for (const row of rows) {
      const entry = byKey.get(row.product.key) ?? {
        product: row.product,
        prices: [],
      };
      entry.prices.push(row.price);
      byKey.set(row.product.key, entry);
    }
    return [...byKey.values()].map(({ product, prices: list }) => ({
      key: product.key,
      service: product.service,
      feature: product.feature,
      kind: product.kind,
      periodicity: product.periodicity,
      graceDays: product.graceDays,
      title: product.title,
      description: product.description,
      prices: list.map((price) => ({
        priceId: price.id,
        version: price.version,
        money: moneyDto(price.amountMinor, price.currency),
      })),
    }));
  }

  /** The current price of a product in one currency, or a contract error. */
  async offer(productKey: string, currency: Currency): Promise<Offer> {
    const [product] = await this.database.db
      .select()
      .from(products)
      .where(and(eq(products.key, productKey), eq(products.active, true)));
    if (!product) throw new AppError("NOT_FOUND");
    const [price] = await this.database.db
      .select()
      .from(prices)
      .where(
        and(
          eq(prices.productKey, productKey),
          eq(prices.currency, currency),
          isNull(prices.validUntil),
        ),
      );
    if (!price)
      throw new AppError("UNPROCESSABLE", {
        fieldErrors: { currency: ["not offered for this product"] },
      });
    return { product, price };
  }
}
