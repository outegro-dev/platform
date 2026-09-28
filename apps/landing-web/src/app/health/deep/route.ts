// Readiness probe path used by the shared Helm chart (/health/deep).
// The landing has no backing services, so readiness equals liveness.
export const dynamic = "force-dynamic";
export { GET } from "../route";
