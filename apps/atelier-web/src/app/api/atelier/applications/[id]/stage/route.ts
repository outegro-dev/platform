import { callAtelier, isApplicationId } from "@/lib/api";
import { refuse, respond, writeBody } from "@/lib/handlers";
import { cardResponseSchema, moveRequestSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Moves a card to another column (an archived card needs a reason). */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/atelier/applications/[id]/stage">,
) {
  const { id } = await params;
  if (!isApplicationId(id)) return refuse(404, "not-found");
  const input = await writeBody(request, moveRequestSchema);
  if (!input.ok) return input.response;
  return respond(
    await callAtelier(
      cardResponseSchema,
      "POST",
      `/applications/${id}/stage`,
      input.body,
    ),
  );
}
