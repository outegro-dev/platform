import { loadPipeline } from "@/lib/api";
import { respond } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/** Jobs, queues and model providers. */
export async function GET() {
  return respond(await loadPipeline());
}
