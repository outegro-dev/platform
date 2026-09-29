export const dynamic = "force-dynamic";

/** Liveness: the process answers. Never depends on the platform services. */
export function GET() {
  return Response.json(
    { status: "ok", service: "admin-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
