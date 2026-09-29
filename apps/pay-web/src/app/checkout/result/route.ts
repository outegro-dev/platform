import { type NextRequest, NextResponse } from "next/server";
import { orderIdFrom } from "@/lib/routes";
import { appUrl } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Default return address of payments-backend (`/checkout/result?orderId=…
 * &result=…`), used by purchases started outside pay-web. The `result`
 * hint is dropped on purpose: the order page asks the server instead.
 */
export function GET(request: NextRequest) {
  const orderId = orderIdFrom(request.nextUrl.searchParams);
  return NextResponse.redirect(
    appUrl(orderId ? `/orders/${orderId}` : "/orders"),
    303,
  );
}
