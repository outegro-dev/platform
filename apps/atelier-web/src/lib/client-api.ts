/*
 * The browser's side of the BFF: writes go to this app's own route
 * handlers under /api/atelier (same origin, cookies attached by the
 * browser), never to atelier-backend directly.
 */

export type WriteFailure =
  | "offline"
  | "signed-out"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "conflict"
  | "failed";

export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: WriteFailure };

const failures: Record<number, WriteFailure> = {
  401: "signed-out",
  403: "forbidden",
  404: "not-found",
  409: "conflict",
  413: "invalid",
  422: "invalid",
  400: "invalid",
};

export async function writeApi<T = unknown>(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<WriteResult<T>> {
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    return { ok: false, failure: "offline" };
  let response: Response;
  try {
    response = await fetch(`/api/atelier${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      failure:
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "offline"
          : "failed",
    };
  }
  if (!response.ok)
    return { ok: false, failure: failures[response.status] ?? "failed" };
  if (response.status === 204) return { ok: true, data: undefined as T };
  try {
    return { ok: true, data: (await response.json()) as T };
  } catch {
    return { ok: true, data: undefined as T };
  }
}
