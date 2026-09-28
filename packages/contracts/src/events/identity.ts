import { z } from "zod";
import { defineEvent } from "../envelope.js";
import { localeSchema } from "../primitives.js";

export const userStatusSchema = z.enum(["active", "suspended", "deleted"]);

export const identityUserCreated = defineEvent(
  "identity.user.created.v1",
  "identity",
  z.object({
    userId: z.uuid(),
    locale: localeSchema,
    status: userStatusSchema,
  }),
);

/**
 * Contact data for Notifications only (its queue is the single consumer).
 * Other events carry ids, not personal data.
 */
export const identityUserContactChanged = defineEvent(
  "identity.user.contact.changed.v1",
  "identity",
  z.object({
    userId: z.uuid(),
    email: z.email().nullable(),
    emailVerified: z.boolean(),
  }),
);

export const identityUserLocaleChanged = defineEvent(
  "identity.user.locale.changed.v1",
  "identity",
  z.object({ userId: z.uuid(), locale: localeSchema }),
);

export const identityUserStatusChanged = defineEvent(
  "identity.user.status.changed.v1",
  "identity",
  z.object({
    userId: z.uuid(),
    status: userStatusSchema,
    accessVersion: z.number().int().nonnegative(),
  }),
);

export const identityRoleBindingChanged = defineEvent(
  "identity.role.binding.changed.v1",
  "identity",
  z.object({
    bindingId: z.uuid(),
    userId: z.uuid(),
    roleKey: z.string().min(1),
    scope: z.string().min(1),
    state: z.enum(["active", "revoked", "expired"]),
    accessVersion: z.number().int().nonnegative(),
  }),
);

export const identitySessionRevoked = defineEvent(
  "identity.session.revoked.v1",
  "identity",
  z.object({
    userId: z.uuid(),
    sessionId: z.uuid(),
    reason: z.enum(["logout", "user", "admin", "reuse_detected", "expired"]),
  }),
);
