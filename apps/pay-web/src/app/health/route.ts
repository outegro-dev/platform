export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "pay-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
