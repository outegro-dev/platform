import { loadInbox } from "@/lib/api";
import { respond } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/** New matches and the tasks that need the owner. */
export async function GET() {
  return respond(await loadInbox());
}
