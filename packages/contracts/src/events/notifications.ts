import { z } from "zod";
import { defineEvent } from "../envelope.js";
import { localeSchema } from "../primitives.js";

export const notificationCategories = [
  "auth",
  "security",
  "billing",
  "service",
] as const;
export const notificationChannels = ["email", "telegram", "inbox"] as const;

/**
 * Command from any service asking Notifications to inform a user. Each
 * service publishes it to its own `<producer>.events` exchange.
 * Unique per (sourceEventId, templateKey, recipient). Login codes do not
 * travel this way (ADR-008: private short-lived delivery path).
 */
export const notificationRequested = defineEvent(
  "notifications.intent.requested.v1",
  "any",
  z.object({
    sourceEventId: z.uuid(),
    templateKey: z.string().regex(/^[a-z]+(\.[a-z-]+)+$/),
    category: z.enum(notificationCategories),
    recipient: z.object({ userId: z.uuid() }),
    locale: localeSchema.optional(),
    channels: z.array(z.enum(notificationChannels)).min(1).optional(),
    data: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
  }),
);

export const notificationDeliveryChanged = defineEvent(
  "notifications.delivery.changed.v1",
  "notifications",
  z.object({
    deliveryId: z.uuid(),
    intentId: z.uuid(),
    userId: z.uuid(),
    channel: z.enum(notificationChannels),
    state: z.enum([
      "pending",
      "leased",
      "accepted",
      "delivered",
      "retry_wait",
      "failed",
      "expired",
      "unknown",
    ]),
  }),
);
