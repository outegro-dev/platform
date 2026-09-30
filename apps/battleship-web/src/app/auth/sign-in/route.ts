import { startSignIn } from "@outegro/bff/sign-in";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ssoClient } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Starts sign-in through id.outegro.dev, back to `returnTo` (home by
 * default). With an unexpired access cookie Identity decides first: an
 * accepted session goes back, a refused one is dropped and signs in again
 * once (see `startSignIn`).
 */
export function GET(request: NextRequest) {
  return startSignIn(request, {
    client: ssoClient,
    appUrl: env.APP_URL,
    fallback: "/",
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
}
