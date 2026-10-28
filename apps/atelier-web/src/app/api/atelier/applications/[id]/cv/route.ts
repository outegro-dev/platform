import { accessToken, isApplicationId, loadViewer } from "@/lib/api";
import { env, mockMode } from "@/lib/env";
import { refuse } from "@/lib/handlers";

export const dynamic = "force-dynamic";

/**
 * The current CV of an application as a PDF, read from atelier-backend with
 * the owner's token: inline for the preview, an attachment with
 * `?download=1`. The file name is the backend's (Name_Role_CV.pdf).
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/atelier/applications/[id]/cv">,
) {
  const { id } = await params;
  if (mockMode || !isApplicationId(id)) return refuse(404, "not-found");
  const viewer = await loadViewer();
  if (viewer.status === "signed-out") return refuse(401, "signed-out");
  if (viewer.status === "no-access") return refuse(403, "forbidden");
  const token = await accessToken();
  let answer: Response;
  try {
    answer = await fetch(
      `${env.ATELIER_API_URL.replace(/\/$/, "")}/applications/${id}/cv.pdf`,
      {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      },
    );
  } catch {
    return refuse(503, "unavailable");
  }
  if (answer.status === 404) return refuse(404, "not-found");
  if (!answer.ok || !answer.body) return refuse(503, "unavailable");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const disposition = (answer.headers.get("content-disposition") ?? "").replace(
    /^attachment/i,
    download ? "attachment" : "inline",
  );
  return new Response(answer.body, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      ...(disposition ? { "content-disposition": disposition } : {}),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
