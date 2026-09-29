import { loadProfile } from "@/lib/api";
import { respond } from "@/lib/respond";

export const dynamic = "force-dynamic";

/** The player's profile for the browser: polled while a payment is processing. */
export async function GET() {
  return respond(await loadProfile());
}
