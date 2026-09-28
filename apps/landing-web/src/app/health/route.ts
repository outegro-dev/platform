// Liveness/startup probe for K3s. No dependencies: the landing has no backend.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "landing-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
