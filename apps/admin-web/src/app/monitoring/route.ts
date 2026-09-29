import type { NextRequest } from "next/server";
import { continueToGrafana } from "@/lib/grafana-gate";
import { getOperator } from "@/lib/server";

export const dynamic = "force-dynamic";

/**
 * Back to Grafana with a fresh console session: the gate sends the browser
 * here when the session needs a refresh. Grafana's own requests with a
 * body arrive with their method kept (307) and leave the same way.
 */
function handle(request: NextRequest) {
  return continueToGrafana(request, { operator: getOperator });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
