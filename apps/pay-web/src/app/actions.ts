"use server";

import { clientHeaders } from "@outegro/bff/client";
import { clearSession, REFRESH_COOKIE } from "@outegro/bff/session";
import { endSession } from "@outegro/bff/sso";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { accessToken, payments } from "@/lib/api";
import { env } from "@/lib/env";
import { idempotencyKeyPattern } from "@/lib/payments/client";
import type { CancelOutcome, CheckoutOutcome } from "@/lib/payments/model";

/*
 * Server actions: same-origin only (Next.js checks Origin against Host),
 * always with the session from the HttpOnly cookie. The browser sends
 * intent, never amounts, user ids or URLs.
 */

/** Ends this app's session in Identity, forgets the cookies, says goodbye. */
export async function signOut() {
  const jar = await cookies();
  await endSession(
    env.AUTH_API_URL,
    jar.get(REFRESH_COOKIE)?.value,
    clientHeaders(await headers(), env.CLIENT_IP_SOURCE),
  );
  clearSession(jar);
  redirect("/signed-out");
}

/** Turns renewal off; the returned state is the server's. */
export async function cancelSubscription(
  subscriptionId: unknown,
): Promise<CancelOutcome> {
  if (typeof subscriptionId !== "string") return { kind: "not-found" };
  const token = await accessToken();
  if (!token) return { kind: "unauthorized" };
  return payments.cancelSubscription(token, subscriptionId);
}

const checkoutSchema = z.object({
  productKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  idempotencyKey: z.string().regex(idempotencyKeyPattern),
});

/**
 * Starts a purchase. The redirect URL in the answer is already checked
 * against CHECKOUT_ORIGINS; without any allowed origin buying stays off.
 */
export async function startCheckout(input: unknown): Promise<CheckoutOutcome> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { kind: "gone" };
  if (!payments.checkoutConfigured) return { kind: "closed" };
  const token = await accessToken();
  if (!token) return { kind: "unauthorized" };
  return payments.checkout(token, parsed.data);
}
