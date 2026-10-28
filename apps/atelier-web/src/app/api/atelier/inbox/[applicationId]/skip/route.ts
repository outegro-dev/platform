import { z } from "zod";
import { callAtelier, isApplicationId } from "@/lib/api";
import { refuse, respond, writeBody } from "@/lib/handlers";
import { cardResponseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Skips a match: it goes to the archive as "skipped". */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/atelier/inbox/[applicationId]/skip">,
) {
  const { applicationId } = await params;
  if (!isApplicationId(applicationId)) return refuse(404, "not-found");
  const input = await writeBody(request, z.object({}).strict());
  if (!input.ok) return input.response;
  return respond(
    await callAtelier(
      cardResponseSchema.optional(),
      "POST",
      `/inbox/${applicationId}/skip`,
      {},
    ),
  );
}
