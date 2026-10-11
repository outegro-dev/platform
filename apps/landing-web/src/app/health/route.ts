// Liveness/startup probe for K3s. The landing has no backend; reading its
// configuration here fails the probe on a bad value, before any page does.
import "@/lib/sso";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok", service: "landing-web" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
