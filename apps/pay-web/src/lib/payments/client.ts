import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { z } from "zod";
import {
  type CancelOutcome,
  type Catalog,
  type CheckoutInput,
  type CheckoutOutcome,
  checkoutStates,
  type Failure,
  grantStates,
  isKnown,
  type Order,
  orderStatuses,
  type Page,
  periodicities,
  productKinds,
  type Result,
  type Subscription,
  subscriptionStates,
} from "./model";

/*
 * The payments API as pay-web uses it. Everything that knows its wire shape
 * lives in this file (payments-backend on feat/payments, fd73609):
 *
 *   GET  /v1/catalog                               public
 *   POST /v1/checkout                               Bearer + Idempotency-Key
 *        { productKey, currency, returnUrl? } → { orderId, attemptId, state, status, paymentUrl }
 *        (buyers come back to <returnUrl>?orderId=…&result=success|failure|cancel;
 *        without returnUrl to PAY_WEB_URL/checkout/result)
 *   GET  /v1/me/orders?cursor&limit                 → { items: OrderView[], nextCursor }
 *   GET  /v1/me/orders/:id                          → OrderView (someone else's: 404)
 *   GET  /v1/me/subscriptions?cursor&limit          → { items: SubscriptionView[], nextCursor }
 *   POST /v1/me/subscriptions/:id/cancel            → SubscriptionView
 *
 * Errors use the platform body { error: { code, fieldErrors, … } }. Unknown
 * fields are ignored and unknown enum values become "unknown", so a newer
 * backend does not break the pages; a missing required field is treated as
 * an outage (logged), never as "no data".
 */

const lenient = <T extends string>(values: readonly T[]) =>
  z
    .string()
    .transform((value): T | "unknown" =>
      isKnown(values, value) ? value : "unknown",
    );

const instant = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "not a date");

const money = z.object({
  minor: z.string().regex(/^-?\d{1,30}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  scale: z.number().int().min(0).max(6),
});

const localized = z.object({ en: z.string(), ru: z.string() });

const access = z.object({
  service: z.string(),
  feature: z.string(),
  state: lenient(grantStates),
  validFrom: instant,
  validUntil: instant.nullable(),
});

const order = z.object({
  id: z.string().min(1),
  productKey: z.string(),
  title: localized,
  kind: lenient(productKinds),
  status: lenient(orderStatuses),
  money,
  createdAt: instant,
  paidAt: instant.nullable(),
  checkout: z
    .object({
      state: z
        .string()
        .transform((value) =>
          isKnown(checkoutStates, value) ? value : ("unknown" as const),
        ),
      paymentUrl: z.string().nullable(),
    })
    .nullable(),
  subscriptionId: z.string().nullable(),
  access: access.nullable(),
}) satisfies z.ZodType<Order, unknown>;

const subscription = z.object({
  id: z.string().min(1),
  orderId: z.string(),
  productKey: z.string(),
  title: localized.nullable(),
  state: lenient(subscriptionStates),
  autoRenew: z.boolean(),
  paidUntil: instant,
  accessUntil: instant,
  money,
  periodicity: lenient(periodicities),
  cancelRequestedAt: instant.nullable(),
  cancelledAt: instant.nullable(),
  expiredAt: instant.nullable(),
  createdAt: instant,
}) satisfies z.ZodType<Subscription, unknown>;

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const catalog = z.object({
  checkoutEnabled: z.boolean(),
  products: z.array(
    z.object({
      key: z.string().min(1),
      service: z.string(),
      feature: z.string(),
      kind: lenient(productKinds),
      periodicity: lenient(periodicities),
      graceDays: z.number().int().nonnegative().catch(0),
      title: localized,
      description: localized,
      prices: z.array(z.object({ priceId: z.string(), money })),
    }),
  ),
}) satisfies z.ZodType<Catalog, unknown>;

const checkout = z.object({
  orderId: z.string().min(1),
  state: z.string(),
  status: z.string(),
  paymentUrl: z.string().nullable(),
});

const uuid = z.uuid();
/** Backend rule for Idempotency-Key. */
export const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/;

type Headers = () => Promise<Record<string, string>> | Record<string, string>;

export type PaymentsClientOptions = {
  baseUrl: string;
  /** https origins a payment page may live on (CHECKOUT_ORIGINS). */
  checkoutOrigins: readonly string[];
  /**
   * Where Lava sends the buyer back; the backend adds orderId and result.
   * Omitted: the backend's default, PAY_WEB_URL + /checkout/result.
   */
  returnUrl?: string;
  /** Browser identity for the service (user agent, client IP). */
  headers?: Headers;
  logger?: Pick<Console, "warn" | "error">;
};

type ReadOptions = { cursor?: string | null; limit?: number };

export class PaymentsClient {
  private readonly call: ReturnType<typeof createBackend>;
  private readonly options: PaymentsClientOptions;
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(options: PaymentsClientOptions) {
    this.options = options;
    this.logger = options.logger ?? console;
    this.call = createBackend(
      options.baseUrl,
      options.headers ? { headers: options.headers } : {},
    );
  }

  /** Buying needs at least one allowed payment origin. */
  get checkoutConfigured(): boolean {
    return this.options.checkoutOrigins.length > 0;
  }

  catalog(): Promise<Result<Catalog>> {
    return this.read("/v1/catalog", null, catalog);
  }

  orders(
    token: string,
    options: ReadOptions = {},
  ): Promise<Result<Page<Order>>> {
    return this.read(`/v1/me/orders${query(options)}`, token, page(order));
  }

  order(token: string, id: string): Promise<Result<Order>> {
    // The API answers 404 for anything that is not a UUID; skip the call.
    if (!uuid.safeParse(id).success)
      return Promise.resolve({ ok: false, error: "not-found" });
    return this.read(`/v1/me/orders/${encodeURIComponent(id)}`, token, order);
  }

  subscriptions(
    token: string,
    options: ReadOptions = {},
  ): Promise<Result<Page<Subscription>>> {
    return this.read(
      `/v1/me/subscriptions${query(options)}`,
      token,
      page(subscription),
    );
  }

  /** Turns renewal off. Repeating it has no new effect, so a retry is safe. */
  async cancelSubscription(token: string, id: string): Promise<CancelOutcome> {
    if (!uuid.safeParse(id).success) return { kind: "not-found" };
    const path = `/v1/me/subscriptions/${encodeURIComponent(id)}/cancel`;
    let raw: unknown;
    try {
      raw = await this.call<unknown>(path, {
        method: "POST",
        accessToken: token,
        timeoutMs: 15_000,
      });
    } catch (error) {
      const failure = this.failure(path, error);
      if (failure === "unauthorized" || failure === "not-found")
        return { kind: failure };
      return { kind: "unavailable" };
    }
    const parsed = this.parse(path, subscription, raw);
    return parsed.ok
      ? { kind: "ok", subscription: parsed.data }
      : { kind: "unavailable" };
  }

  /**
   * Starts (or, with the same key, re-reads) a purchase. Price and buyer are
   * decided by the server; the browser is only ever sent to an https page on
   * an allowed origin.
   */
  async checkout(
    token: string,
    input: CheckoutInput,
  ): Promise<CheckoutOutcome> {
    if (!idempotencyKeyPattern.test(input.idempotencyKey))
      return { kind: "conflict" };
    const path = "/v1/checkout";
    let raw: unknown;
    try {
      raw = await this.call<unknown>(path, {
        method: "POST",
        accessToken: token,
        headers: { "idempotency-key": input.idempotencyKey },
        // The body is strict on the backend: only these keys, no amounts.
        body: {
          productKey: input.productKey,
          currency: input.currency,
          ...(this.options.returnUrl
            ? { returnUrl: this.options.returnUrl }
            : {}),
        },
        timeoutMs: 20_000,
      });
    } catch (error) {
      if (error instanceof BackendError) {
        if (error.status === 401) return { kind: "unauthorized" };
        if (error.status === 404) return { kind: "gone" };
        if (error.status === 409) return { kind: "conflict" };
        if (error.status === 422) {
          const fields = error.error.fieldErrors ?? {};
          if (fields.productKey?.length) return { kind: "owned" };
          if (fields.checkout?.length) return { kind: "closed" };
          return { kind: "gone" };
        }
      }
      this.failure(path, error);
      return { kind: "unavailable" };
    }
    const parsed = this.parse(path, checkout, raw);
    if (!parsed.ok) return { kind: "unavailable" };
    const { orderId, state, status, paymentUrl } = parsed.data;
    if (status === "paid") return { kind: "paid", orderId };
    if (status === "failed" || state === "failed")
      return { kind: "failed", orderId };
    if (!paymentUrl) return { kind: "preparing", orderId };
    if (!this.isAllowedPaymentUrl(paymentUrl)) {
      this.logger.warn(
        "[payments] checkout returned a payment page outside CHECKOUT_ORIGINS",
      );
      return { kind: "blocked", orderId };
    }
    return { kind: "redirect", orderId, url: paymentUrl };
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

  private async read<T>(
    path: string,
    token: string | null,
    schema: z.ZodType<T, unknown>,
  ): Promise<Result<T>> {
    let raw: unknown;
    try {
      raw = await this.call<unknown>(path, { accessToken: token });
    } catch (error) {
      return { ok: false, error: this.failure(path, error) };
    }
    return this.parse(path, schema, raw);
  }

  private parse<T>(
    path: string,
    schema: z.ZodType<T, unknown>,
    raw: unknown,
  ): Result<T> {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, data: parsed.data };
    const issue = parsed.error.issues[0];
    this.logger.error(
      `[payments] ${pathOnly(path)} answered outside the contract`,
      issue ? `${issue.path.join(".")}: ${issue.message}` : "",
    );
    return { ok: false, error: "unavailable" };
  }

  private failure(path: string, error: unknown): Failure {
    if (error instanceof BackendError) {
      if (error.status === 401) return "unauthorized";
      if (error.status === 404) return "not-found";
      if (error.status === 400) return "invalid";
      return "unavailable";
    }
    if (!(error instanceof BackendUnavailable))
      this.logger.error(`[payments] ${pathOnly(path)} failed`, error);
    return "unavailable";
  }
}

function query({ cursor, limit }: ReadOptions) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (limit) params.set("limit", String(limit));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Logs never carry cursors or ids from the query string. */
const pathOnly = (path: string) => path.split("?")[0];
