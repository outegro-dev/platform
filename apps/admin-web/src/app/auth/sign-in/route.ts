import type { NextRequest } from "next/server";
import { getOperator } from "@/lib/server";
import { startSignIn } from "@/lib/sign-in";

export const dynamic = "force-dynamic";

/**
 * Starts sign-in through id.outegro.dev. With an unexpired access cookie,
 * Identity decides first: an accepted session goes back, a refused one is
 * dropped and signs in again (see `startSignIn`).
 */
export function GET(request: NextRequest) {
  return startSignIn(request, { operator: getOperator });
}
