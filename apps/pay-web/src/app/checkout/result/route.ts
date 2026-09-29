import { type NextRequest, NextResponse } from "next/server";
import { returnPath } from "@/lib/routes";
import { appUrl } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Return address from Lava (payments-backend's default when a checkout
 * passes no returnUrl): /checkout/result?orderId=<uuid>&result=… opens the
 * live order page. `result=success` proves nothing and is dropped; only
 * "failure" and "cancel" travel on, as a wording hint for a pending order.
 */
export function GET(request: NextRequest) {
  return NextResponse.redirect(
    appUrl(returnPath(request.nextUrl.searchParams)),
    303,
  );
}
