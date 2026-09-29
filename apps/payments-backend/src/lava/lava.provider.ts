import { z } from "zod";
import { isCurrency } from "../domain/money.js";
import {
  type CreatedInvoice,
  type CreateInvoiceInput,
  type InvoiceQuery,
  type PaymentProvider,
  type ProviderInvoice,
  ProviderRejectedError,
  ProviderUnavailableError,
} from "./provider.js";

export type LavaOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  /** Allowed payment page hosts ("pay.lava.top", "*.lava.top"); empty: any https host. */
  paymentUrlHosts: string[];
};

const createdSchema = z.object({
  id: z.string().min(1).max(128),
  paymentUrl: z.string().nullish(),
});

const invoiceSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.string().nullish(),
  datetime: z.string().nullish(),
  status: z.enum(["NEW", "IN_PROGRESS", "COMPLETED", "FAILED"]),
  receipt: z
    .object({
      amount: z.union([z.number(), z.string()]).nullish(),
      currency: z.string().nullish(),
    })
    .nullish(),
  buyer: z.object({ email: z.string().nullish() }).nullish(),
  parentInvoice: z.object({ id: z.string().nullish() }).nullish(),
});

const pageSchema = z.object({
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative().optional(),
});

const invoiceTypes = new Set([
  "INVOICE",
  "SUBSCRIPTION_FIRST_INVOICE",
  "SUBSCRIPTION_RENEWAL",
]);
const ALL_STATUSES = ["NEW", "IN_PROGRESS", "COMPLETED", "FAILED"];
const PAGE_SIZE = 50;
const MAX_PAGES = 5;

/** Errors raised before a request could reach the provider. */
const NOT_SENT = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function describe(error: unknown) {
  const cause = (error as { cause?: { code?: string } })?.cause;
  if ((error as Error)?.name === "TimeoutError") return "timeout";
  return cause?.code ?? (error as Error)?.name ?? "network error";
}

/**
 * Lava.top public API (OpenAPI 1.22.0, saved 27.09.2026), key in X-Api-Key.
 * Only the operations the service needs; responses are parsed leniently and
 * mapped to the provider port, never passed through.
 */
export class LavaPaymentProvider implements PaymentProvider {
  readonly name = "lava" as const;
  readonly configured = true;

  constructor(private readonly options: LavaOptions) {}

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    const response = await this.send("POST", "/api/v3/invoice", {
      body: {
        email: input.email,
        offerId: input.offerId,
        currency: input.currency,
        periodicity: input.periodicity,
        buyerLanguage: input.buyerLanguage,
        successful_return_url: input.returnUrls.success,
        failure_return_url: input.returnUrls.failure,
        cancel_return_url: input.returnUrls.cancel,
      },
    });
    if (response.status >= 400 && response.status < 500)
      throw new ProviderRejectedError(`lava_${response.status}`);
    if (response.status < 200 || response.status >= 300)
      throw new ProviderUnavailableError(`lava_${response.status}`);
    const parsed = createdSchema.safeParse(response.json);
    // A 2xx we cannot read may still have created an invoice.
    if (!parsed.success)
      throw new ProviderUnavailableError("unreadable invoice response");
    const { id, paymentUrl } = parsed.data;
    if (!paymentUrl) throw new ProviderRejectedError("no_payment_url", id);
    if (!this.allowedPaymentUrl(paymentUrl))
      throw new ProviderRejectedError("payment_url_not_allowed", id);
    return { invoiceId: id, paymentUrl };
  }

  async getInvoice(invoiceId: string): Promise<ProviderInvoice | null> {
    const response = await this.send(
      "GET",
      `/api/v2/invoices/${encodeURIComponent(invoiceId)}`,
    );
    if (response.status === 404) return null;
    if (response.status !== 200)
      throw new ProviderUnavailableError(`lava_${response.status}`);
    return this.toInvoice(response.json);
  }

  async findInvoices(query: InvoiceQuery): Promise<ProviderInvoice[]> {
    const found: ProviderInvoice[] = [];
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
      const response = await this.send("GET", "/api/v2/invoices", {
        query: {
          buyerEmail: query.buyerEmail,
          beginDate: query.from.toISOString(),
          endDate: query.to.toISOString(),
          // The provider default is "completed only"; every status is asked for explicitly.
          invoiceStatuses: ALL_STATUSES,
          page: String(pageNumber),
          size: String(PAGE_SIZE),
        },
      });
      if (response.status !== 200)
        throw new ProviderUnavailableError(`lava_${response.status}`);
      const parsed = pageSchema.safeParse(response.json);
      if (!parsed.success)
        throw new ProviderUnavailableError("unreadable invoice page");
      for (const item of parsed.data.items) found.push(this.toInvoice(item));
      const total = parsed.data.total ?? 0;
      if (
        parsed.data.items.length < PAGE_SIZE ||
        pageNumber * PAGE_SIZE >= total
      )
        break;
    }
    return found;
  }

  async cancelSubscription(input: { parentContractId: string; email: string }) {
    const response = await this.send("DELETE", "/api/v1/subscriptions", {
      query: { contractId: input.parentContractId, email: input.email },
    });
    if (response.status === 204 || response.status === 200)
      return "cancelled" as const;
    if (response.status === 404) return "not_found" as const;
    if (response.status >= 400 && response.status < 500)
      throw new ProviderRejectedError(`lava_${response.status}`);
    throw new ProviderUnavailableError(`lava_${response.status}`);
  }

  private toInvoice(raw: unknown): ProviderInvoice {
    const parsed = invoiceSchema.safeParse(raw);
    if (!parsed.success)
      throw new ProviderUnavailableError("unreadable invoice");
    const invoice = parsed.data;
    const amount = invoice.receipt?.amount;
    const currency = invoice.receipt?.currency;
    return {
      id: invoice.id,
      type:
        invoice.type && invoiceTypes.has(invoice.type)
          ? (invoice.type as ProviderInvoice["type"])
          : null,
      status: invoice.status,
      datetime: invoice.datetime ?? null,
      amount:
        amount === null || amount === undefined ? null : String(amount).trim(),
      currency: isCurrency(currency) ? currency : null,
      buyerEmail: invoice.buyer?.email ?? null,
      parentInvoiceId: invoice.parentInvoice?.id ?? null,
    };
  }

  private allowedPaymentUrl(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    if (url.protocol !== "https:") return false;
    const hosts = this.options.paymentUrlHosts;
    if (!hosts.length) return true;
    return hosts.some((host) =>
      host.startsWith("*.")
        ? url.hostname.endsWith(host.slice(1))
        : url.hostname === host,
    );
  }

  private async send(
    method: "GET" | "POST" | "DELETE",
    path: string,
    options: {
      query?: Record<string, string | string[]>;
      body?: unknown;
    } = {},
  ) {
    const url = new URL(path, this.options.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      for (const item of [value].flat()) url.searchParams.append(key, item);
    }
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          "X-Api-Key": this.options.apiKey,
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        // The key must never follow a redirect to another host.
        redirect: "manual",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } })?.cause?.code;
      throw new ProviderUnavailableError(
        describe(error),
        !(cause && NOT_SENT.has(cause)),
      );
    }
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new ProviderUnavailableError(`body: ${describe(error)}`);
    }
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }
}

/** No API key: every call fails before leaving the process. */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly name = "lava" as const;
  readonly configured = false;

  private fail(): never {
    throw new ProviderUnavailableError(
      "payment provider not configured",
      false,
    );
  }
  async createInvoice(): Promise<CreatedInvoice> {
    this.fail();
  }
  async getInvoice(): Promise<ProviderInvoice | null> {
    this.fail();
  }
  async findInvoices(): Promise<ProviderInvoice[]> {
    this.fail();
  }
  async cancelSubscription(): Promise<"cancelled" | "not_found"> {
    this.fail();
  }
}
