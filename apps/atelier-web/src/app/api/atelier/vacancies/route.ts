import { addVacancyRequestSchema } from "@outegro/contracts/atelier";
import { callAtelier } from "@/lib/api";
import { respond, writeBody } from "@/lib/handlers";
import { addVacancyResponseSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";

/** Adds a vacancy by its link or its pasted text. */
export async function POST(request: Request) {
  const input = await writeBody(request, addVacancyRequestSchema);
  if (!input.ok) return input.response;
  return respond(
    await callAtelier(
      addVacancyResponseSchema,
      "POST",
      "/vacancies",
      input.body,
    ),
    201,
  );
}
