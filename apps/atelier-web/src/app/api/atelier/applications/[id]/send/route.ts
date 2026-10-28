import { z } from "zod";
import { callAtelier, isApplicationId } from "@/lib/api";
import { refuse, respond, writeBody } from "@/lib/handlers";
import { jobAcceptedSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Sends a ready application through its channel. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/atelier/applications/[id]/send">,
) {
  const { id } = await params;
  if (!isApplicationId(id)) return refuse(404, "not-found");
  const input = await writeBody(request, z.object({}).strict());
  if (!input.ok) return input.response;
  return respond(
    await callAtelier(
      jobAcceptedSchema,
      "POST",
      `/applications/${id}/send`,
      {},
    ),
    202,
  );
}
