import type { NextRequest } from "next/server";
import { authorizeGrafana, createOperatorCache } from "@/lib/grafana-gate";
import { getOperator } from "@/lib/server";

export const dynamic = "force-dynamic";

/** One per server process: Grafana's bursts cost one Identity call per session. */
const cache = createOperatorCache();

/**
 * Traefik's ForwardAuth for Grafana under /grafana/ (always GET, with the
 * browser's cookies, X-Forwarded-Uri and X-Forwarded-Method). The contract:
 * docs/06-operations/grafana-sso.md.
 */
export function GET(request: NextRequest) {
  return authorizeGrafana(request, { operator: getOperator, cache });
}
