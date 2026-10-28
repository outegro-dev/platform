import { callAtelier, isApplicationId } from "@/lib/api";
import { refuse, respond, writeBody } from "@/lib/handlers";
import { jobAcceptedSchema, retryRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Runs the pipeline again from a step (the failed one by default). */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/atelier/applications/[id]/retry">,
) {
  const { id } = await params;
  if (!isApplicationId(id)) return refuse(404, "not-found");
  const input = await writeBody(request, retryRequestSchema);
  if (!input.ok) return input.response;
  return respond(
    await callAtelier(
      jobAcceptedSchema,
      "POST",
      `/applications/${id}/retry`,
      input.body,
    ),
    202,
  );
}
