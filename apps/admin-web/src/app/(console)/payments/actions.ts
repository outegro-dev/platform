"use server";

import { adminReasonSchema } from "@outegro/contracts";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";

const uuid = z.uuid();

/** Stops renewal; paid time is kept. Not a refund. */
export async function cancelSubscription(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "subscriptions.cancel",
    form,
    schema: z.object({ subscriptionId: uuid, reason: adminReasonSchema }),
    run: (services, input) =>
      services.payments.cancelSubscription(input.subscriptionId, input.reason),
    success: (t) => t("done.subscriptionCancelled"),
    explain: (error) =>
      error.error.code === "UNPROCESSABLE" || error.error.code === "CONFLICT"
        ? "state"
        : null,
  });
}

/** Records that a refund was started in the Lava cabinet; Lava's event confirms it. */
export async function requestRefund(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "refunds.request",
    form,
    schema: z.object({ paymentId: uuid, reason: adminReasonSchema }),
    run: (services, input) =>
      services.payments.requestRefund(input.paymentId, input.reason),
    success: (t) => t("done.refundRequested"),
    explain: (error) => (error.error.code === "UNPROCESSABLE" ? "state" : null),
  });
}

/** Links an unmatched provider refund to its purchase after checking evidence. */
export async function matchRefund(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "refunds.request",
    form,
    schema: z.object({
      refundId: uuid,
      paymentId: uuid,
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.payments.matchRefund(
        input.refundId,
        input.paymentId,
        input.reason,
      ),
    success: (t) => t("done.refundMatched"),
    explain: (error) => (error.error.code === "UNPROCESSABLE" ? "state" : null),
  });
}
