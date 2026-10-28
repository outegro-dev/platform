export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "atelier-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
