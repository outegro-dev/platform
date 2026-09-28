export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "id-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
