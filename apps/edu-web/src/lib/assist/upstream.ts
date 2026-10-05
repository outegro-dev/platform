import type { AssistRefusal } from "./protocol";

/*
 * edu-backend's refusals as the reader's page can act on them. Before an
 * answer starts, edu-backend answers with the platform's JSON error
 * (`{ error: { code, fieldErrors, retryable } }`, http-errors.md); the
 * assistant's own reasons are in `fieldErrors.assist`.
 */

function assistReasons(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return [];
  const fieldErrors = (error as { fieldErrors?: unknown }).fieldErrors;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return [];
  const assist = (fieldErrors as { assist?: unknown }).assist;
  return Array.isArray(assist)
    ? assist.filter((reason): reason is string => typeof reason === "string")
    : [];
}

/** A refusal from edu-backend's status and JSON error body. */
export function refusalOf(status: number, body: unknown): AssistRefusal {
  const reasons = assistReasons(body);
  if (status === 401) return "signed-out";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 413) return "too-large";
  if (status === 400 || status === 422) return "invalid";
  if (status === 429)
    return reasons.includes("daily_limit") ? "daily-limit" : "busy";
  if (status === 503 && reasons.includes("disabled")) return "disabled";
  // The day's answers of all readers are used up: back tomorrow, no retry.
  if (status === 503 && reasons.includes("paused")) return "paused";
  if (status === 503 && reasons.includes("busy")) return "busy";
  return "unavailable";
}

/** Whether a response is the answer's event stream (and not an error page). */
export function isEventStream(contentType: string | null): boolean {
  return (contentType ?? "").toLowerCase().startsWith("text/event-stream");
}

/**
 * Whether a state-changing request comes from this app's own pages: the
 * same Origin, or, without one, Sec-Fetch-Site "same-origin". Browsers send
 * Origin with every POST, so a request without both is not a page's.
 */
export function isSameOrigin(
  headers: { get(name: string): string | null },
  appUrl: string,
): boolean {
  const origin = headers.get("origin");
  if (origin) return origin === new URL(appUrl).origin;
  return headers.get("sec-fetch-site") === "same-origin";
}

/** A request body as read: its JSON, or why there is none. */
export type JsonBody =
  | { kind: "json"; value: unknown }
  /** Over the limit: refused without reading the rest. */
  | { kind: "too-large" }
  /** No body, or not JSON. */
  | { kind: "invalid" };

/**
 * Reads a request body as JSON, at most `limit` bytes: a larger one is
 * refused without reading the rest.
 */
export async function readJsonBody(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<JsonBody> {
  if (!body) return { kind: "invalid" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return { kind: "too-large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { kind: "json", value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { kind: "invalid" };
  }
}
