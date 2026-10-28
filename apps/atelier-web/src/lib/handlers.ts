import type { z } from "zod";
import type { Loaded } from "./api";
import { fromThisApp } from "./sso";

/*
 * The BFF's route handlers under /api/atelier: what the browser calls for
 * writes (and fresh reads). Each one checks the caller's origin for writes,
 * validates the body before it leaves, and answers with the backend's data
 * or a small error the interface can name.
 */

const statusOf: Record<Exclude<Loaded<unknown>["status"], "ok">, number> = {
  "signed-out": 401,
  forbidden: 403,
  "not-found": 404,
  invalid: 422,
  conflict: 409,
  unavailable: 502,
};

const noStore = { "Cache-Control": "no-store" };

/** The outcome as JSON: the data, or `{ error }` with its status. */
export function respond<T>(loaded: Loaded<T>, okStatus = 200): Response {
  if (loaded.status === "ok")
    return loaded.data === undefined
      ? new Response(null, { status: 204, headers: noStore })
      : Response.json(loaded.data, { status: okStatus, headers: noStore });
  return Response.json(
    {
      error: loaded.status,
      ...("code" in loaded ? { code: loaded.code } : {}),
    },
    { status: statusOf[loaded.status], headers: noStore },
  );
}

export function refuse(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: noStore });
}

/**
 * A write from this app's own pages, with a body that passes `schema`;
 * otherwise the response that refuses it.
 */
export async function writeBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  if (!fromThisApp(request))
    return { ok: false, response: refuse(403, "cross-origin") };
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 400_000)
      return { ok: false, response: refuse(413, "too-large") };
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, response: refuse(400, "invalid-json") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: refuse(422, "invalid") };
  return { ok: true, body: parsed.data };
}
