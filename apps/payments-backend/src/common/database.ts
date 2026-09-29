import type { DatabaseHandle } from "@outegro/nest-common";
import { DrizzleQueryError } from "drizzle-orm";
import type * as schema from "../db/schema.js";

export type PaymentsDatabase = DatabaseHandle<typeof schema>;
export type PaymentsDb = PaymentsDatabase["db"];
export type PaymentsTx = Parameters<
  Parameters<PaymentsDb["transaction"]>[0]
>[0];
/** The database or an open transaction. */
export type Executor = PaymentsDb | PaymentsTx;

export type OrderRow = typeof schema.orders.$inferSelect;
export type AttemptRow = typeof schema.checkoutAttempts.$inferSelect;
export type SubscriptionRow = typeof schema.subscriptions.$inferSelect;
export type PaymentRow = typeof schema.payments.$inferSelect;
export type GrantRow = typeof schema.grants.$inferSelect;
export type ProviderEventRow = typeof schema.providerEvents.$inferSelect;
export type RefundRow = typeof schema.refunds.$inferSelect;
export type CustomerRow = typeof schema.customers.$inferSelect;

/** PostgreSQL unique_violation, optionally for one constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === "23505" && (!constraint || pg.constraint === constraint);
}

/**
 * An error fit for logs and stored diagnostics. A failed query's message
 * carries its SQL and parameters (raw payloads, buyer emails), so only the
 * driver's code and message are kept.
 */
export function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const pg = error.cause as { code?: unknown; message?: unknown } | undefined;
    const code = typeof pg?.code === "string" ? `${pg.code} ` : "";
    const message = typeof pg?.message === "string" ? pg.message : "failed";
    return `database: ${code}${message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
