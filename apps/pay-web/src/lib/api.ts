import { createBackend } from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { env } from "./env";
import { PaymentsClient } from "./payments/client";
import type { Order } from "./payments/model";
import { signInPath } from "./sso";

/*
 * Server-side access to platform services. The browser never talks to them
 * and never sees a token: pages, route handlers and server actions call
 * these with the session cookie.
 */

// Every call runs inside a request, so the browser identity is at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

/** All calls to the payments service go through this one client. */
export const payments = new PaymentsClient({
  baseUrl: env.PAYMENTS_API_URL,
  checkoutOrigins: env.CHECKOUT_ORIGINS,
  // Lava sends the buyer back to /orders?orderId=…; that page opens the order.
  returnUrl: new URL("/orders", env.APP_URL).toString(),
  headers: forward,
});

const authApi = createBackend(env.AUTH_API_URL, { headers: forward });

/**
 * The order as the browser may see it: a payment link survives only when
 * it is an https page on an allowed origin.
 */
export function forBrowser(order: Order): Order {
  const url = order.checkout?.paymentUrl;
  if (!order.checkout || !url || payments.isAllowedPaymentUrl(url))
    return order;
  return { ...order, checkout: { ...order.checkout, paymentUrl: null } };
}

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/** The session token for a page, or a trip through sign-in back to `from`. */
export async function requireToken(from: string): Promise<string> {
  const token = await accessToken();
  if (!token) redirect(signInPath(from));
  return token;
}

const meSchema = z.object({
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
});

/**
 * Who is signed in, for the header. Optional: when Identity is slow or down
 * the header falls back to a generic account label, the page still works.
 */
export const loadMe = cache(async () => {
  const token = await accessToken();
  if (!token) return null;
  try {
    const me = meSchema.parse(
      await authApi<unknown>("/v1/me", { accessToken: token, timeoutMs: 3000 }),
    );
    return me;
  } catch {
    return null;
  }
});
