import { mockMode } from "@/lib/env";
import { refuse } from "@/lib/handlers";
import { mockCvIdSchema, mockCvOwner } from "@/lib/mock";
import { mockCvPdf } from "@/lib/mock-pdf";

export const dynamic = "force-dynamic";

/** Mock mode only: a CV version as a real one-page PDF, shown inline. */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/atelier/mock/cv/[versionId]">,
) {
  if (!mockMode) return refuse(404, "not-found");
  const { versionId } = await params;
  if (!mockCvIdSchema.safeParse(versionId).success)
    return refuse(404, "not-found");
  const owner = mockCvOwner(versionId);
  if (!owner?.detail.cv) return refuse(404, "not-found");
  const pdf = mockCvPdf({
    name: "Rowan Ellery",
    headline: "Senior Full-Stack Engineer",
    company: owner.card.company,
    role: owner.card.role,
  });
  return new Response(new Blob([pdf as BlobPart]), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${owner.detail.cv.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
