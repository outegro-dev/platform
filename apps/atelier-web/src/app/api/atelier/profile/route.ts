import { loadProfile } from "@/lib/api";
import { respond } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/** The profile summary: cases, preferences and form answers. */
export async function GET() {
  return respond(await loadProfile());
}
