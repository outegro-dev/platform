import type { GrantRow } from "../common/database.js";

/** What applying one provider fact did; stored on its provider event. */
export type Outcome = {
  status: "processed" | "ignored" | "unmatched" | "mismatch";
  note?: string;
  orderId?: string | null;
  subscriptionId?: string | null;
  paymentId?: string | null;
  refundId?: string | null;
  /** Source of a grant the fact made active; counted after the commit. */
  grantActivated?: GrantRow["sourceType"];
};

/** A provider timestamp is trusted for the past, never for the future. */
export const notAfter = (value: Date, now: Date) => (value > now ? now : value);
