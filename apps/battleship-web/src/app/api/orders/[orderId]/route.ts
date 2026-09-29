import { accessToken, payments } from "@/lib/api";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * The status of an order the buyer came back from, asked with the
 * session's token: `{ status: paid | failed | pending, feature }`.
 */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const token = await accessToken();
  if (!token) {
    return Response.json(
      { error: "signed_out" },
      { status: 401, headers: noStore },
    );
  }
  const { orderId } = await params;
  // Unknown or unreachable reads as "not settled yet"; the shop keeps waiting.
  const order = (await payments.order(orderId, token)) ?? {
    status: "pending",
    feature: null,
  };
  return Response.json(order, { headers: noStore });
}
