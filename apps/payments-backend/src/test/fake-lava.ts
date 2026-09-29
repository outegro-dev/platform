import { randomUUID } from "node:crypto";
import type { ManualClock } from "@outegro/nest-common";
import { catalog } from "../domain/catalog.js";
import {
  type CreatedInvoice,
  type CreateInvoiceInput,
  type InvoiceQuery,
  type PaymentProvider,
  type ProviderInvoice,
  ProviderRejectedError,
  ProviderUnavailableError,
} from "../lava/provider.js";

export type FakeInvoice = ProviderInvoice & {
  offerId: string;
  createdAt: Date;
  paymentUrl: string;
  input: CreateInvoiceInput;
};

/**
 * In-memory stand-in for Lava (explicitly a fake: tests never call the real
 * API). Counts calls and can reject, lose the answer after creating the
 * invoice, run a hook before answering (early webhook), or fail reads.
 */
export class FakeLava implements PaymentProvider {
  readonly name = "lava" as const;
  configured = true;
  invoices: FakeInvoice[] = [];
  createCalls = 0;
  /** ok | reject (4xx) | timeout (created, answer lost) | refused (never sent) */
  mode: "ok" | "reject" | "timeout" | "refused" = "ok";
  /** Runs after the invoice exists and before the answer is returned. */
  beforeAnswer: ((invoice: FakeInvoice) => Promise<void>) | null = null;
  /** Reads (get/find) throw like a rate-limited provider. */
  failReads = false;
  cancelCalls: { parentContractId: string; email: string }[] = [];
  cancelMode: "ok" | "timeout" | "not_found" | "reject" = "ok";

  constructor(private readonly clock: ManualClock) {}

  reset() {
    this.mode = "ok";
    this.beforeAnswer = null;
    this.failReads = false;
    this.cancelMode = "ok";
  }

  async createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
    this.createCalls++;
    if (this.mode === "reject") throw new ProviderRejectedError("lava_400");
    if (this.mode === "refused")
      throw new ProviderUnavailableError("ECONNREFUSED", false);
    const product = catalog.find((p) => p.providerOfferId === input.offerId);
    const id = randomUUID();
    const invoice: FakeInvoice = {
      id,
      type:
        product?.kind === "subscription"
          ? "SUBSCRIPTION_FIRST_INVOICE"
          : "INVOICE",
      status: "NEW",
      datetime: this.clock.now().toISOString(),
      amount: product?.prices[input.currency] ?? null,
      currency: input.currency,
      buyerEmail: input.email,
      parentInvoiceId: null,
      offerId: input.offerId,
      createdAt: this.clock.now(),
      paymentUrl: `https://app.lava.top/pay/${id}`,
      input,
    };
    this.invoices.push(invoice);
    if (this.beforeAnswer) await this.beforeAnswer(invoice);
    if (this.mode === "timeout") throw new ProviderUnavailableError("timeout");
    return { invoiceId: invoice.id, paymentUrl: invoice.paymentUrl };
  }

  async getInvoice(invoiceId: string) {
    if (this.failReads) throw new ProviderUnavailableError("lava_429");
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    return invoice ? this.publicView(invoice) : null;
  }

  async findInvoices(query: InvoiceQuery) {
    if (this.failReads) throw new ProviderUnavailableError("lava_429");
    return this.invoices
      .filter(
        (i) =>
          i.buyerEmail?.toLowerCase() === query.buyerEmail.toLowerCase() &&
          i.createdAt >= query.from &&
          i.createdAt <= query.to,
      )
      .map((i) => this.publicView(i));
  }

  async cancelSubscription(input: { parentContractId: string; email: string }) {
    this.cancelCalls.push(input);
    switch (this.cancelMode) {
      case "ok":
        return "cancelled" as const;
      case "not_found":
        return "not_found" as const;
      case "timeout":
        throw new ProviderUnavailableError("timeout");
      case "reject":
        throw new ProviderRejectedError("lava_400");
    }
  }

  /** The buyer paid on the Lava page. */
  complete(invoiceId: string, at = this.clock.now()) {
    const invoice = this.find(invoiceId);
    invoice.status = "COMPLETED";
    invoice.datetime = at.toISOString();
    return invoice;
  }

  find(invoiceId: string) {
    const invoice = this.invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new Error(`fake invoice ${invoiceId} not found`);
    return invoice;
  }

  last() {
    const invoice = this.invoices.at(-1);
    if (!invoice) throw new Error("no fake invoice yet");
    return invoice;
  }

  private publicView(invoice: FakeInvoice): ProviderInvoice {
    return {
      id: invoice.id,
      type: invoice.type,
      status: invoice.status,
      datetime: invoice.datetime,
      amount: invoice.amount,
      currency: invoice.currency,
      buyerEmail: invoice.buyerEmail,
      parentInvoiceId: invoice.parentInvoiceId,
    };
  }
}
