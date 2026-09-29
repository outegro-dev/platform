import { randomUUID } from "node:crypto";

/**
 * Synthetic webhook bodies in the two documented Lava shapes (OpenAPI
 * 1.22.0 examples, saved 27.09.2026). Ids, emails and amounts are fake.
 */
type Money = { amount: number; currency: "RUB" | "USD" | "EUR" };

const product = {
  id: "d31384b8-e412-4be5-a2ec-297ae6666c8f",
  title: "Test product",
};

export const lavaPayloads = {
  paymentSuccess(
    input: Money & {
      contractId: string;
      email: string;
      at: Date;
      subscription?: boolean;
    },
  ) {
    return {
      eventType: "payment.success",
      product,
      buyer: { email: input.email },
      contractId: input.contractId,
      amount: input.amount,
      currency: input.currency,
      timestamp: input.at.toISOString(),
      status: input.subscription ? "subscription-active" : "completed",
      errorMessage: "",
    };
  },

  paymentFailed(
    input: Money & {
      contractId: string;
      email: string;
      at: Date;
      subscription?: boolean;
    },
  ) {
    return {
      eventType: "payment.failed",
      product,
      buyer: { email: input.email },
      contractId: input.contractId,
      amount: input.amount,
      currency: input.currency,
      timestamp: input.at.toISOString(),
      status: input.subscription ? "subscription-failed" : "failed",
      errorMessage: "Payment window is opened but not completed",
    };
  },

  renewalSuccess(
    input: Money & {
      contractId?: string;
      parentContractId: string;
      email: string;
      at: Date;
    },
  ) {
    return {
      eventType: "subscription.recurring.payment.success",
      product,
      buyer: { email: input.email },
      contractId: input.contractId ?? randomUUID(),
      parentContractId: input.parentContractId,
      amount: input.amount,
      currency: input.currency,
      timestamp: input.at.toISOString(),
      status: "subscription-active",
      errorMessage: "",
    };
  },

  renewalFailed(
    input: Money & {
      contractId?: string;
      parentContractId: string;
      email: string;
      at: Date;
    },
  ) {
    return {
      eventType: "subscription.recurring.payment.failed",
      product,
      buyer: { email: input.email },
      contractId: input.contractId ?? randomUUID(),
      parentContractId: input.parentContractId,
      amount: input.amount,
      currency: input.currency,
      timestamp: input.at.toISOString(),
      status: "subscription-failed",
      errorMessage: "Not sufficient funds",
    };
  },

  cancelled(input: {
    contractId: string;
    email: string;
    cancelledAt: Date;
    willExpireAt: Date;
  }) {
    return {
      eventType: "subscription.cancelled",
      contractId: input.contractId,
      product,
      buyer: { email: input.email },
      cancelledAt: input.cancelledAt.toISOString(),
      willExpireAt: input.willExpireAt.toISOString(),
    };
  },

  refund(
    input: Money & {
      tierId: string;
      email: string;
      at: Date;
      refundType?: "full" | "partial";
      eventId?: string;
      refundId?: string;
      subscriptionCancelled?: boolean;
    },
  ) {
    return {
      event_id: input.eventId ?? randomUUID(),
      event_type: "refund.success",
      created_at: input.at.toISOString(),
      data: {
        refund_id: input.refundId ?? randomUUID(),
        refund_type: input.refundType ?? "full",
        initiator: "creator",
        amount: input.amount,
        currency: input.currency,
        product: {
          product_name: "Test product",
          product_id: product.id,
          product_type: "DIGITAL_PRODUCT",
          tier_id: input.tierId,
        },
        customer_email: input.email,
        balance_impact: {
          debited_amount: input.amount,
          currency: input.currency,
        },
        subscription_cancelled: input.subscriptionCancelled ?? false,
      },
    };
  },

  chargeback(input: Money & { tierId: string; email: string; at: Date }) {
    const id = randomUUID();
    return {
      event_id: id,
      event_type: "chargeback.initiated",
      created_at: input.at.toISOString(),
      data: {
        chargeback_id: id,
        dispute_date: input.at.toISOString().slice(0, 10),
        reason_category: "fraud",
        reason_description: "Fraudulent transaction",
        amount: input.amount,
        currency: input.currency,
        product: {
          product_name: "Test product",
          product_id: product.id,
          product_type: "DIGITAL_PRODUCT",
          tier_id: input.tierId,
        },
        customer_email: input.email,
        balance_impact: {
          debited_amount: input.amount,
          provider_fee: 0.5,
          currency: input.currency,
        },
        subscription_cancelled: false,
      },
    };
  },
};
