import type { NextRequest } from "next/server";
import { accessToken, forBrowser, payments } from "@/lib/api";

export const dynamic = "force-dynamic";

const reply = (body: object, status: number) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * The return page polls this every few seconds. It answers with the
 * server's view of the order only; query parameters from the payment
 * provider never reach it. Someone else's order looks exactly like a
 * missing one.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/orders/[id]">,
) {
  const { id } = await context.params;
  const token = await accessToken();
  if (!token) return reply({ status: "signed-out" }, 401);
  const result = await payments.order(token, id);
  if (result.ok)
    return reply({ status: "ok", order: forBrowser(result.data) }, 200);
  switch (result.error) {
    case "unauthorized":
      return reply({ status: "signed-out" }, 401);
    case "not-found":
    case "invalid":
      return reply({ status: "not-found" }, 404);
    default:
      return reply({ status: "unavailable" }, 503);
  }
}
