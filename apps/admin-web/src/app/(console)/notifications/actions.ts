"use server";

import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";

const reason = z.string().trim().min(3).max(500);
const channel = z.enum(["email", "telegram"]);

export async function retryDelivery(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "notifications.retry",
    form,
    schema: z.object({
      deliveryId: z.uuid(),
      reason,
      confirmUnknown: z.literal("true").optional(),
    }),
    run: (services, input) =>
      services.notifications
        .retry(input.deliveryId, {
          reason: input.reason,
          confirmUnknown: input.confirmUnknown === "true",
        })
        .then(() => undefined),
    success: (t) => t("done.retried"),
    explain: (error) => {
      const fields = error.error.fieldErrors ?? {};
      if (fields.confirmUnknown) return "confirm-required";
      if (fields.intent) return "expired";
      if (fields.delivery) return "private";
      if (fields.state) return "not-retryable";
      return null;
    },
  });
}

/** Pause or resume an external channel; deliveries wait while it is paused. */
export async function setChannel(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "services.flags",
    form,
    schema: z.object({
      channel,
      enabled: z.enum(["true", "false"]),
      expectedVersion: z.coerce.number().int().nonnegative(),
      reason,
    }),
    run: (services, input) =>
      services.notifications
        .updateSettings({
          expectedVersion: input.expectedVersion,
          channels: { [input.channel]: { enabled: input.enabled === "true" } },
          reason: input.reason,
        })
        .then(() => undefined),
    success: (t, input) =>
      t(
        input.enabled === "true" ? "done.channelResumed" : "done.channelPaused",
        {
          channel: input.channel,
        },
      ),
  });
}

/** A check message to the operator's own address or chat. */
export async function sendTestMessage(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "notifications.retry",
    form,
    schema: z.object({ channel }),
    run: (services, input) =>
      services.notifications.testMessage(input.channel).then(() => undefined),
    success: (t, input) => t("done.testSent", { channel: input.channel }),
  });
}
