import { mockMode } from "@/lib/env";
import { refuse } from "@/lib/handlers";
import { resetMock } from "@/lib/mock";

export const dynamic = "force-dynamic";

/** Mock mode only: start the made-up data over (end-to-end tests). */
export function POST() {
  if (!mockMode) return refuse(404, "not-found");
  resetMock();
  return new Response(null, { status: 204 });
}
