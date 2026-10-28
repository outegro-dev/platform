export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "roulette-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
