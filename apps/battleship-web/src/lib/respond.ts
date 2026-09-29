import type { Loaded } from "./api";

/** A server-side read as a JSON response for the browser (never cached). */
export function respond<T>(result: Loaded<T>) {
  const headers = { "Cache-Control": "no-store" };
  switch (result.status) {
    case "ok":
      return Response.json(result.data, { headers });
    case "signed-out":
      return Response.json({ error: "signed_out" }, { status: 401, headers });
    case "forbidden":
      return Response.json({ error: "forbidden" }, { status: 403, headers });
    case "not-found":
      return Response.json({ error: "not_found" }, { status: 404, headers });
    default:
      return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
