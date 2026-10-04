import { clientHeaders } from "@outegro/bff/client";
import { bookSlugSchema } from "@outegro/contracts/edu";
import type { NextRequest } from "next/server";
import { accessToken } from "@/lib/api";
import {
  type AssistRefusal,
  assistBodySchemas,
  isAssistKind,
  refusalStatus,
} from "@/lib/assist/protocol";
import {
  isEventStream,
  isSameOrigin,
  readJsonBody,
  refusalOf,
} from "@/lib/assist/upstream";
import { MAX_BODY_BYTES } from "@/lib/body-size";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
/**
 * How long edu-backend may take to start answering: it waits up to 20
 * seconds for a free model slot before its 503; after that the stream
 * itself keeps the connection alive.
 */
const START_TIMEOUT_MS = 30_000;

const noStore = { "cache-control": "no-store" };

/** Refusals that are part of an ordinary day: not worth a log line each. */
const ordinary: readonly AssistRefusal[] = [
  "signed-out",
  "daily-limit",
  // The shared daily limit: edu-backend raises its own alert once.
  "paused",
];

/**
 * A refusal as the page reads it, logged by kind and reason only (never
 * the reader's words, the answer or the token). A session that ended and
 * used-up limits are ordinary and are not logged.
 */
function refuse(kind: string, refusal: AssistRefusal) {
  if (!ordinary.includes(refusal))
    console.warn(
      JSON.stringify({
        level: "warn",
        msg: "assistant request refused",
        // Only a known kind: the path is the caller's to choose.
        kind: isAssistKind(kind) ? kind : "unknown",
        refusal,
      }),
    );
  return Response.json(
    { refusal },
    { status: refusalStatus[refusal], headers: noStore },
  );
}

/**
 * The reading assistant through the BFF: "explain it differently",
 * "explain it in your own words" and the SQL task hint. Same-origin pages
 * only (Origin, or Sec-Fetch-Site); the body (at most MAX_BODY_BYTES, under
 * edu-backend's own limit) is checked with the contract before edu-backend
 * sees it; the session's access token goes along from the httpOnly cookie
 * (the proxy has refreshed it). edu-backend's refusals
 * (JSON, before the stream) become typed refusals; the answer's Server-Sent
 * Events are relayed as they come, unbuffered. The reader going away (or
 * stopping) aborts the call, which stops the model.
 */
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/books/[slug]/assist/[kind]">,
) {
  const { slug, kind } = await context.params;
  if (!isSameOrigin(request.headers, env.APP_URL))
    return refuse(kind, "forbidden");
  if (!bookSlugSchema.safeParse(slug).success || !isAssistKind(kind))
    return refuse(kind, "not-found");
  const token = await accessToken();
  if (!token) return refuse(kind, "signed-out");
  const raw = await readJsonBody(request.body, MAX_BODY_BYTES);
  if (raw.kind === "too-large") return refuse(kind, "too-large");
  const parsed =
    raw.kind === "json" ? assistBodySchemas[kind].safeParse(raw.value) : null;
  if (!parsed?.success) return refuse(kind, "invalid");

  const upstream = new AbortController();
  const hangUp = () => upstream.abort();
  if (request.signal.aborted) return refuse(kind, "unavailable");
  request.signal.addEventListener("abort", hangUp, { once: true });
  const release = () => request.signal.removeEventListener("abort", hangUp);
  const slow = setTimeout(hangUp, START_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      `${env.EDU_API_URL}/v1/me/books/${slug}/assist/${kind}`,
      {
        method: "POST",
        headers: {
          ...clientHeaders(request.headers, env.CLIENT_IP_SOURCE),
          accept: "text/event-stream",
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        signal: upstream.signal,
      },
    );
  } catch {
    // edu-backend unreachable, too slow to start, or the reader left.
    release();
    return refuse(kind, "unavailable");
  } finally {
    clearTimeout(slow);
  }

  const body = response.body;
  if (
    !response.ok ||
    !body ||
    !isEventStream(response.headers.get("content-type"))
  ) {
    const error = await response.json().catch(() => undefined);
    release();
    return refuse(
      kind,
      response.ok ? "unavailable" : refusalOf(response.status, error),
    );
  }

  const reader = body.getReader();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    release();
  };
  const relay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch {
        // edu-backend broke off, or the reader left: the page reads the
        // stream's end without `done` as an interrupted answer.
        finish();
        try {
          controller.close();
        } catch {
          // Already cancelled by the reader.
        }
      }
    },
    cancel() {
      finish();
      upstream.abort();
      void reader.cancel().catch(() => undefined);
    },
  });

  return new Response(relay, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
