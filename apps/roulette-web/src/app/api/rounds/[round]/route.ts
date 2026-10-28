import { loadRound } from "@/lib/api";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** One round for the check on /fair: the backend's public data, passed through. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ round: string }> },
) {
  const raw = (await params).round;
  const round = Number(raw);
  if (!/^\d{1,12}$/.test(raw) || !Number.isSafeInteger(round) || round < 1) {
    return Response.json(
      { error: "bad_round" },
      { status: 400, headers: noStore },
    );
  }
  const result = await loadRound(round);
  switch (result.status) {
    case "ok":
      return Response.json(result.data, { headers: noStore });
    case "not-found":
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: noStore },
      );
    default:
      return Response.json(
        { error: "unavailable" },
        { status: 503, headers: noStore },
      );
  }
}
