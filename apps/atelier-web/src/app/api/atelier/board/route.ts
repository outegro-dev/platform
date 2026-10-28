import { loadBoard } from "@/lib/api";
import { respond } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/** The board: columns of application cards and the stats strip. */
export async function GET() {
  return respond(await loadBoard());
}
