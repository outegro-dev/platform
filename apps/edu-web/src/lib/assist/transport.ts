import type { AssistEvent } from "@outegro/contracts/edu";
import { MAX_BODY_BYTES, textBytes } from "@/lib/body-size";
import {
  type AssistBodies,
  type AssistKind,
  type AssistRefusal,
  assistPath,
  isAssistRefusal,
} from "./protocol";
import { readAssistEvents } from "./sse";

/*
 * How the reader's stores reach the assistant: one call per answer, through
 * this app's own route handler (same origin; the session cookie goes along,
 * the token never reaches the browser). The stores get the transport
 * through their constructors, so their tests script it.
 */

/** What asking the assistant came to before the first words. */
export type AssistReply =
  /** The answer streams: text pieces, then `done` or `error`. */
  | { kind: "stream"; events: AsyncIterable<AssistEvent> }
  /** Refused before it started (a JSON error). */
  | { kind: "refused"; reason: AssistRefusal }
  /** No answer at all: the connection failed (or the page went offline). */
  | { kind: "network" };

export type AssistTransport = {
  ask<K extends AssistKind>(
    slug: string,
    kind: K,
    body: AssistBodies[K],
    signal: AbortSignal,
  ): Promise<AssistReply>;
};

/** The refusal in a JSON error body of the BFF; unknown ones are "unavailable". */
async function refusalOf(response: Response): Promise<AssistRefusal> {
  try {
    const body = (await response.json()) as { refusal?: unknown };
    if (isAssistRefusal(body.refusal)) return body.refusal;
  } catch {
    // Not the BFF's JSON (a proxy's error page): the service is not there.
  }
  return "unavailable";
}

/**
 * The browser's transport: fetch to the route handler, Server-Sent Events
 * back. A body larger than edu-backend takes is refused here, unsent (it
 * would never get through). An abort (stop, a newer request, leaving the
 * page) rejects with the signal's reason, which the caller recognises as
 * its own.
 */
export function fetchTransport(
  fetcher: typeof fetch = (...args) => fetch(...args),
): AssistTransport {
  return {
    async ask(slug, kind, body, signal) {
      const payload = JSON.stringify(body);
      if (textBytes(payload) > MAX_BODY_BYTES)
        return { kind: "refused", reason: "too-large" };
      let response: Response;
      try {
        response = await fetcher(assistPath(slug, kind), {
          method: "POST",
          headers: {
            accept: "text/event-stream",
            "content-type": "application/json",
          },
          body: payload,
          credentials: "same-origin",
          cache: "no-store",
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw error;
        return { kind: "network" };
      }
      if (!response.ok)
        return { kind: "refused", reason: await refusalOf(response) };
      const type = response.headers.get("content-type") ?? "";
      if (!response.body || !type.startsWith("text/event-stream"))
        return { kind: "refused", reason: "unavailable" };
      return { kind: "stream", events: readAssistEvents(response.body) };
    },
  };
}
