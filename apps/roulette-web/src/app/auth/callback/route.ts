import { finishSignIn } from "@outegro/bff/sign-in";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ssoClient } from "@/lib/sso";

export const dynamic = "force-dynamic";

/**
 * Back from id.outegro.dev: check the state, swap the code for this app's
 * own session (server to server), then return where sign-in started. A
 * failed silent attempt lands there signed out, any other failure on the
 * error page (see `finishSignIn`).
 */
export function GET(request: NextRequest) {
  return finishSignIn(request, {
    client: ssoClient,
    appUrl: env.APP_URL,
    fallback: "/",
    errorPath: (reason) => `/auth/error?reason=${reason}`,
    clientIpSource: env.CLIENT_IP_SOURCE,
  });
}
