export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "edu-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
