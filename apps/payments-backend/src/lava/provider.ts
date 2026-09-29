import type { Currency } from "../domain/money.js";
import type { Periodicity } from "../domain/periods.js";

/** Injection token for the payment provider port. */
export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type CreateInvoiceInput = {
  email: string;
  offerId: string;
  currency: Currency;
  periodicity: Periodicity;
  buyerLanguage: "EN" | "RU";
  returnUrls: { success: string; failure: string; cancel: string };
};

export type CreatedInvoice = {
  invoiceId: string;
  paymentUrl: string;
};

export type InvoiceStatus = "NEW" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
export type InvoiceType =
  | "INVOICE"
  | "SUBSCRIPTION_FIRST_INVOICE"
  | "SUBSCRIPTION_RENEWAL";

/** A provider contract (invoice) as reconciliation sees it. */
export type ProviderInvoice = {
  id: string;
  type: InvoiceType | null;
  status: InvoiceStatus;
  /** Execution time, or creation time while not executed (ISO). */
  datetime: string | null;
  /** Decimal string as the provider reported it. */
  amount: string | null;
  currency: Currency | null;
  buyerEmail: string | null;
  parentInvoiceId: string | null;
};

export type InvoiceQuery = {
  buyerEmail: string;
  from: Date;
  to: Date;
};

/**
 * The provider definitely did not create anything (4xx, refused before the
 * request left). The attempt fails; a new purchase needs a new command.
 */
export class ProviderRejectedError extends Error {
  constructor(
    readonly reason: string,
    readonly invoiceId: string | null = null,
  ) {
    super(reason);
  }
}

/**
 * The outcome is unknown or the provider is unavailable: timeout, network
 * error after sending, 5xx, unreadable 2xx. Never repeat a create blindly.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly reason: string,
    /** false only when the request provably never reached the provider. */
    readonly maybeSent = true,
  ) {
    super(reason);
  }
}

/**
 * Payment provider port. The Lava adapter implements it for production; a
 * fake implements it in tests. Nothing outside `src/lava` knows HTTP details.
 */
export interface PaymentProvider {
  readonly name: "lava";
  /** false when no API key is configured: checkout is unavailable. */
  readonly configured: boolean;
  createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice>;
  /** null when the provider does not know the invoice. */
  getInvoice(invoiceId: string): Promise<ProviderInvoice | null>;
  /** Invoices of one buyer created in a window, every status. */
  findInvoices(query: InvoiceQuery): Promise<ProviderInvoice[]>;
  /** Turns off renewal. "not_found" when the provider has no such subscription. */
  cancelSubscription(input: {
    parentContractId: string;
    email: string;
  }): Promise<"cancelled" | "not_found">;
}
