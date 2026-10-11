import { startSignIn } from "@outegro/bff/sign-in";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { sso, ssoOff } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Starts sign-in through id.outegro.dev, back to `returnTo` (the main page
 * by default). `silent=1` comes from the proxy's silent sign-in: no sign-in
 * page at id.outegro.dev, at most one attempt in a while (see `startSignIn`).
 */
export function GET(request: NextRequest) {
  if (!sso) return ssoOff();
  return startSignIn(request, {
    client: sso.client,
    appUrl: sso.appUrl,
    fallback: "/",
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
}
