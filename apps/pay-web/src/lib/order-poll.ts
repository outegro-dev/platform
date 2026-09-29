import type { Order } from "./payments/model";

/** One look at an order through this app's BFF (/api/orders/:id). */
export type OrderPollResult =
  | { status: "ok"; order: Order }
  | { status: "not-found" }
  | { status: "signed-out" }
  | { status: "unavailable" };

export async function pollOrder(orderId: string): Promise<OrderPollResult> {
  let response: Response;
  try {
    response = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.status === 401) return { status: "signed-out" };
  if (response.status === 404) return { status: "not-found" };
  if (!response.ok) return { status: "unavailable" };
  try {
    const body = (await response.json()) as { status?: string; order?: Order };
    return body.status === "ok" && body.order
      ? { status: "ok", order: body.order }
      : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
