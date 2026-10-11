import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { refreshSession } from "@outegro/bff/proxy";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import type { AccountMenuUser } from "@outegro/ui/lib/platform";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { sso, ssoOff } from "@/lib/sso";

export const dynamic = "force-dynamic";

const meSchema = z.object({
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
  roles: z.array(z.string()).catch([]),
});

/**
 * Who is signed in, for the header. Pages stay the same for every visitor
 * (public and cacheable), so the browser asks here after the page loads:
 * the session is refreshed when it is about to expire, and Identity
 * (`/v1/me`) names the person. The answer is `{ name, email, roles }`, or
 * null: no session or one Identity refuses (200), or Identity could not be
 * asked (503). 404 while SSO is off: the site has no accounts then. Never
 * stored by any cache.
 */
export async function GET(request: NextRequest) {
  if (!sso) return ssoOff();
  const { authApiUrl } = sso;
  const session = await refreshSession(request, authApiUrl, {
    clientIpSource: env.CLIENT_IP_SOURCE,
    silent: true,
  });
  const reply = (account: AccountMenuUser | null, status = 200) =>
    session.apply(
      NextResponse.json(account, {
        status,
        headers: { "Cache-Control": "private, no-store" },
      }),
    );
  if (session.outcome === "unavailable") return reply(null, 503);
  // A refreshed token is already on the request (see refreshSession).
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return reply(null);
  const forwarded = clientHeaders(request.headers, env.CLIENT_IP_SOURCE);
  try {
    const me = meSchema.parse(
      await createBackend(authApiUrl, { headers: () => forwarded })("/v1/me", {
        accessToken: token,
        timeoutMs: 3000,
      }),
    );
    return reply({ name: me.displayName, email: me.email, roles: me.roles });
  } catch (error) {
    if (error instanceof BackendError && error.status === 401)
      return reply(null);
    if (!(error instanceof BackendError || error instanceof BackendUnavailable))
      console.error("[bff] /v1/me answered outside the contract", error);
    return reply(null, 503);
  }
}
