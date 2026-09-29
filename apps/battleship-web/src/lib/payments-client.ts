import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { battleshipService } from "@outegro/contracts/battleship";
import { z } from "zod";
import {
  type Catalog,
  type CatalogProduct,
  type CheckoutOutcome,
  type CheckoutRequest,
  checkoutReferencePattern,
  currencies,
  type OrderStatus,
} from "./catalog";

/*
 * The payments API as this app uses it. Everything that knows its shape
 * lives in this file:
 *   GET  {PAYMENTS_API_URL}/v1/catalog                      (public)
 *   POST {PAYMENTS_API_URL}/v1/checkout  { productKey, currency, returnUrl }
 *        + Authorization: Bearer, Idempotency-Key
 *   GET  {PAYMENTS_API_URL}/v1/me/orders/{orderId}          (Bearer)
 * After the provider's page the buyer lands on returnUrl with
 * ?orderId=…&result=success|failure|cancel appended by payments.
 */

const localized = z.object({ en: z.string(), ru: z.string() });

const catalogSchema = z.object({
  checkoutEnabled: z.boolean(),
  products: z.array(
    z.object({
      key: z.string().min(1),
      service: z.string(),
      feature: z.string().min(1),
      kind: z.enum(["subscription", "one_time"]),
      periodicity: z.enum(["MONTHLY", "ONE_TIME"]),
      graceDays: z.number().int().nonnegative().optional(),
      title: localized,
      description: localized,
      prices: z.array(
        z.object({
          priceId: z.string().min(1),
          version: z.number().int().optional(),
          money: z.object({
            minor: z.string().regex(/^-?\d+$/),
            currency: z.enum(currencies),
            scale: z.number().int().min(0).max(4),
          }),
        }),
      ),
    }),
  ),
});

const orderSchema = z
  .object({
    status: z.string(),
    feature: z.string().optional(),
    productKey: z.string().optional(),
  })
  .passthrough();

const paidStatuses = new Set([
  "paid",
  "succeeded",
  "success",
  "completed",
  "active",
]);

const checkoutSchema = z.object({
  orderId: z.string().min(1),
  attemptId: z.string().nullable().optional(),
  state: z.string(),
  status: z.string().optional(),
  paymentUrl: z.string().nullable(),
});

/** Order states that mean "the payment page is still being created". */
const preparingStates = new Set(["requesting", "unknown"]);
/** Order states that will never produce a payment page. */
const failedStates = new Set([
  "failed",
  "cancelled",
  "canceled",
  "expired",
  "rejected",
]);

export type PaymentsClientOptions = {
  /** Unset: payments are not wired yet, the shop shows "coming soon". */
  baseUrl: string | undefined;
  /** Public address of this app, for the return URL. */
  appUrl: string;
  /** https origins a payment page may live on. */
  checkoutOrigins: readonly string[];
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
  logger?: Pick<Console, "warn" | "error">;
};

export class PaymentsClient {
  private readonly call: ReturnType<typeof createBackend> | null;
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(private readonly options: PaymentsClientOptions) {
    this.call = options.baseUrl
      ? createBackend(options.baseUrl, {
          ...(options.headers ? { headers: options.headers } : {}),
        })
      : null;
    this.logger = options.logger ?? console;
  }

  get configured(): boolean {
    return this.call !== null;
  }

  /** The game's products, titles in the visitor's language. */
  async catalog(locale: "en" | "ru"): Promise<Catalog> {
    if (!this.call)
      return { status: "unconfigured", checkoutEnabled: false, products: [] };
    let raw: unknown;
    try {
      raw = await this.call<unknown>("/v1/catalog");
    } catch {
      return { status: "unavailable", checkoutEnabled: false, products: [] };
    }
    const parsed = catalogSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        "[payments] catalog outside the contract",
        parsed.error.issues[0],
      );
      return { status: "unavailable", checkoutEnabled: false, products: [] };
    }
    const products: CatalogProduct[] = parsed.data.products
      .filter((product) => product.service === battleshipService)
      .map((product) => ({
        key: product.key,
        feature: product.feature,
        kind: product.kind,
        periodicity: product.periodicity,
        title: product.title[locale],
        description: product.description[locale],
        prices: product.prices.map(({ priceId, money }) => ({
          priceId,
          money,
        })),
      }));
    return {
      status: "ok",
      checkoutEnabled: parsed.data.checkoutEnabled,
      products,
    };
  }

  /**
   * Starts (or, with the same reference, re-reads) a checkout. The browser
   * is only ever sent to an https page on an allowed origin.
   */
  async checkout(
    request: CheckoutRequest & { accessToken: string },
  ): Promise<CheckoutOutcome> {
    if (!this.call) return { kind: "error", reason: "unavailable" };
    if (!checkoutReferencePattern.test(request.reference))
      return { kind: "error", reason: "rejected" };
    let raw: unknown;
    try {
      raw = await this.call<unknown>("/v1/checkout", {
        method: "POST",
        accessToken: request.accessToken,
        headers: { "idempotency-key": request.reference },
        body: {
          productKey: request.productKey,
          currency: request.currency,
          returnUrl: this.returnUrl(),
        },
        timeoutMs: 15_000,
      });
    } catch (error) {
      if (error instanceof BackendError) {
        if (error.status === 401)
          return { kind: "error", reason: "unauthorized" };
        // Already owned or already subscribed.
        if (error.status === 422) return { kind: "owned" };
        // 409: this key was used with another input; 4xx: refused.
        if (error.status < 500) return { kind: "error", reason: "rejected" };
      }
      if (
        !(error instanceof BackendUnavailable || error instanceof BackendError)
      )
        this.logger.error("[payments] checkout failed", error);
      return { kind: "error", reason: "unavailable" };
    }
    const parsed = checkoutSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        "[payments] checkout outside the contract",
        parsed.error.issues[0],
      );
      return { kind: "error", reason: "unavailable" };
    }
    const { paymentUrl, state } = parsed.data;
    if (paymentUrl === null) {
      const normalized = state.toLowerCase();
      if (preparingStates.has(normalized)) return { kind: "preparing" };
      if (failedStates.has(normalized))
        return { kind: "error", reason: "rejected" };
      return { kind: "pending" };
    }
    if (!this.isAllowedPaymentUrl(paymentUrl)) {
      this.logger.warn(
        "[payments] payment URL on an origin that is not allowed",
      );
      return { kind: "error", reason: "blocked" };
    }
    return { kind: "redirect", url: paymentUrl };
  }

  /** Only https pages on CHECKOUT_ORIGINS, without credentials in the URL. */
  isAllowedPaymentUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        url.username === "" &&
        url.password === "" &&
        this.options.checkoutOrigins.includes(url.origin)
      );
    } catch {
      return false;
    }
  }

  /** Where the provider sends the buyer back; payments appends orderId and result. */
  returnUrl(): string {
    return new URL("/shop", this.options.appUrl).toString();
  }

  /** The state of an order the buyer came back from (null: unknown or unreachable). */
  async order(
    orderId: string,
    accessToken: string,
  ): Promise<OrderStatus | null> {
    if (!this.call || !/^[0-9A-Za-z-]{8,64}$/.test(orderId)) return null;
    let raw: unknown;
    try {
      raw = await this.call<unknown>(
        `/v1/me/orders/${encodeURIComponent(orderId)}`,
        { accessToken },
      );
    } catch {
      return null;
    }
    const parsed = orderSchema.safeParse(raw);
    if (!parsed.success) return null;
    const status = parsed.data.status.toLowerCase();
    const feature =
      parsed.data.feature ??
      (parsed.data.productKey === "battleship-premium"
        ? "premium"
        : parsed.data.productKey === "battleship-silver-fleet"
          ? "cosmetics.silver-fleet"
          : null);
    return {
      status: paidStatuses.has(status)
        ? "paid"
        : failedStates.has(status)
          ? "failed"
          : "pending",
      feature,
    };
  }
}
