"use server";

import { adminReasonSchema, platformRoles } from "@outegro/contracts";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";

const uuid = z.uuid();
const roles = Object.keys(platformRoles) as [string, ...string[]];

/** "2026-12-31" → end of that day in UTC; must be in the future. */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value, context) => {
    if (!value) return null;
    const at = new Date(`${value}T23:59:59.000Z`);
    if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) {
      context.addIssue({ code: "custom", message: "future date" });
      return z.NEVER;
    }
    return at.toISOString();
  });

export async function setUserStatus(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "users.suspend",
    form,
    schema: z.object({
      userId: uuid,
      status: z.enum(["active", "suspended"]),
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.identity
        .setStatus(input.userId, input.status, input.reason)
        .then(() => undefined),
    success: (t, input) =>
      t(input.status === "suspended" ? "done.suspended" : "done.restored"),
    explain: (error) =>
      error.error.code === "UNPROCESSABLE" ? "last-owner" : null,
  });
}

export async function revokeUserSessions(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  let revoked = 0;
  return runAction({
    permission: "sessions.revoke",
    form,
    schema: z.object({ userId: uuid, reason: adminReasonSchema }),
    run: async (services, input) => {
      revoked = (
        await services.identity.revokeSessions(input.userId, input.reason)
      ).revoked;
    },
    success: (t) => t("done.sessionsRevoked", { count: revoked }),
  });
}

/** A lost device's passkey; the user keeps another way to sign in. */
export async function revokeUserPasskey(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "passkeys.revoke",
    form,
    schema: z.object({
      userId: uuid,
      passkeyId: uuid,
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.identity.revokePasskey(
        input.userId,
        input.passkeyId,
        input.reason,
      ),
    success: (t) => t("done.passkeyRevoked"),
    explain: (error) =>
      error.error.fieldErrors?.passkey?.includes("last_method")
        ? "last-method"
        : null,
  });
}

export async function grantRole(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "roles.assign",
    form,
    schema: z.object({
      userId: uuid,
      role: z.enum(roles),
      expiresAt: optionalDate,
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.identity
        .grantRole(input.userId, {
          role: input.role,
          reason: input.reason,
          expiresAt: input.expiresAt,
        })
        .then(() => undefined),
    success: (t, input) => t("done.roleGranted", { role: input.role }),
    explain: (error) =>
      error.error.code === "CONFLICT" ? "role-active" : null,
  });
}

export async function revokeRole(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "roles.assign",
    form,
    schema: z.object({
      bindingId: uuid,
      role: z.string().max(64),
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.identity.revokeRole(input.bindingId, input.reason),
    success: (t, input) => t("done.roleRevoked", { role: input.role }),
    explain: (error) =>
      error.error.code === "UNPROCESSABLE" ? "last-owner" : null,
  });
}

/** Manual commercial access lives in Payments, the owner of grants. */
export async function grantAccess(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "grants.assign",
    form,
    schema: z.object({
      userId: uuid,
      target: z.string().regex(/^[a-z][a-z0-9-]{1,40}:[a-z][a-z0-9.-]{1,80}$/),
      validUntil: optionalDate,
      reason: adminReasonSchema,
    }),
    run: (services, input) => {
      const [service = "", feature = ""] = input.target.split(":");
      return services.payments.grant({
        userId: input.userId,
        service,
        feature,
        validUntil: input.validUntil,
        reason: input.reason,
      });
    },
    success: (t) => t("done.accessGranted"),
    explain: (error) =>
      error.error.code === "CONFLICT"
        ? "grant-exists"
        : error.error.code === "UNPROCESSABLE"
          ? "invalid"
          : null,
  });
}

export async function revokeAccess(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "grants.assign",
    form,
    schema: z.object({ grantId: uuid, reason: adminReasonSchema }),
    run: (services, input) =>
      services.payments.revokeGrant(input.grantId, input.reason),
    success: (t) => t("done.accessRevoked"),
    explain: (error) => (error.error.code === "UNPROCESSABLE" ? "state" : null),
  });
}
