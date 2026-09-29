import { createBackend } from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { Call, Transport } from "./adapters/base";
import { BattleshipAdmin } from "./adapters/battleship";
import { IdentityAdmin, type Operator } from "./adapters/identity";
import { NotificationsAdmin } from "./adapters/notifications";
import { PaymentsAdmin } from "./adapters/payments";
import { env } from "./env";
import { type Loaded, load } from "./result";

/**
 * Composition root of the BFF: one client per service, the browser identity
 * forwarded on every call, the operator's token from the HttpOnly cookie.
 */

// Every call runs inside a request, so the browser identity is always at hand.
export const forwardedHeaders = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

const client = (baseUrl: string): Call =>
  createBackend(baseUrl, { headers: forwardedHeaders });

const clients = {
  auth: client(env.AUTH_API_URL),
  notifications: client(env.NOTIFICATIONS_API_URL),
  battleship: env.BATTLESHIP_API_URL ? client(env.BATTLESHIP_API_URL) : null,
  payments: env.PAYMENTS_ADMIN_API_URL
    ? client(env.PAYMENTS_ADMIN_API_URL)
    : null,
};

export async function accessToken(): Promise<string | null> {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

export function createServices(
  token: () => Promise<string | null> = accessToken,
) {
  const transport = (call: Call): Transport => ({ call, token });
  return {
    identity: new IdentityAdmin(transport(clients.auth)),
    notifications: new NotificationsAdmin(transport(clients.notifications)),
    battleship: new BattleshipAdmin(
      "battleship",
      clients.battleship ? transport(clients.battleship) : null,
    ),
    payments: new PaymentsAdmin(
      "payments",
      clients.payments ? transport(clients.payments) : null,
    ),
  };
}
export type Services = ReturnType<typeof createServices>;

/** One set of adapters per server render. */
export const services = cache(() => createServices());

/**
 * The signed-in operator with roles and permissions, read fresh from
 * Identity once per request: navigation and every page gate use it, and
 * each backend checks the permission again on its side.
 */
export const getOperator = cache(async (): Promise<Loaded<Operator>> => {
  if (!(await accessToken())) return { ok: false, kind: "unauthenticated" };
  return load(() => services().identity.me());
});
