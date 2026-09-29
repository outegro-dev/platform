export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "battleship-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
