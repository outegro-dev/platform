import { callAtelier } from "@/lib/api";
import { refuse, respond } from "@/lib/handlers";
import { providerResponseSchema } from "@/lib/schemas";
import { fromThisApp } from "@/lib/sso";

export const dynamic = "force-dynamic";

/** Lifts a model provider's pause before it runs out. */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/atelier/providers/[id]/pause">,
) {
  if (!fromThisApp(request)) return refuse(403, "cross-origin");
  const { id } = await params;
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(id)) return refuse(404, "not-found");
  return respond(
    await callAtelier(
      providerResponseSchema.optional(),
      "DELETE",
      `/providers/${encodeURIComponent(id)}/pause`,
    ),
  );
}
