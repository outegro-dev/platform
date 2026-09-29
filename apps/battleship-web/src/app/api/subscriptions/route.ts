import { accessToken, payments } from "@/lib/api";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * The player's subscriptions from payments, read with the session's token:
 * the shop asks again after a purchase, for the renewal date. `items: null`
 * when payments cannot say; the shop then keeps what the game told it.
 */
export async function GET() {
  const token = await accessToken();
  if (!token) {
    return Response.json(
      { error: "signed_out" },
      { status: 401, headers: noStore },
    );
  }
  const items = await payments.subscriptions(token);
  return Response.json({ items }, { headers: noStore });
}
