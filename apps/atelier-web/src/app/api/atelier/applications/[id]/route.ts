import { isApplicationId, loadApplication } from "@/lib/api";
import { refuse, respond } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/** One application with its CV, fit, texts, contacts, history and pipeline. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/atelier/applications/[id]">,
) {
  const { id } = await params;
  if (!isApplicationId(id)) return refuse(404, "not-found");
  return respond(await loadApplication(id));
}
