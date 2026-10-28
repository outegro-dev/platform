import { load } from "@/lib/result";
import { services } from "@/lib/server";
import type { LiveAnswer } from "@/stores/roulette-live-store";

export const dynamic = "force-dynamic";

/**
 * The roulette's live table for the Live page, which asks every few
 * seconds while it is visible. The proxy has refreshed the session; the
 * call carries the operator's own token, and roulette-backend checks
 * `roulette.read` itself. These reads are not operator activity: the
 * page marks them, and the proxy does not count them toward staying
 * signed in.
 */
export async function GET() {
  const result = await load(() => services().roulette.live());
  const body: LiveAnswer = result.ok
    ? { ok: true, data: result.data, serverTime: new Date().toISOString() }
    : { ok: false, kind: result.kind };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
