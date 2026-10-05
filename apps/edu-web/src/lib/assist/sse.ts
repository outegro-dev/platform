import { type AssistEvent, assistEventSchema } from "@outegro/contracts/edu";

/*
 * Server-Sent Events of the assistant: `data: <JSON>` lines, an event per
 * blank line, `: keep-alive` comments while the model thinks. The decoder
 * follows the event-stream format (any line ending, comments ignored, other
 * fields skipped) and knows nothing of the network, so it is tested on its
 * own; the reader turns a response body into the contract's events.
 */

/** Splits event-stream text, fed in pieces of any size, into event data. */
export class SseDecoder {
  /** The line being read: no line ending seen yet. */
  private line = "";
  /** The `data:` values of the event being read. */
  private data: string[] = [];
  /** The last piece ended with CR: an LF opening the next one belongs to it. */
  private afterCr = false;

  /** Feeds the next piece; returns the data of every event it completes. */
  push(text: string): string[] {
    const events: string[] = [];
    let start = 0;
    let i = 0;
    if (this.afterCr && text.startsWith("\n")) {
      start = 1;
      i = 1;
    }
    this.afterCr = false;
    for (; i < text.length; i++) {
      const char = text[i];
      if (char !== "\n" && char !== "\r") continue;
      this.take(this.line + text.slice(start, i), events);
      this.line = "";
      if (char === "\r") {
        if (i + 1 === text.length) this.afterCr = true;
        else if (text[i + 1] === "\n") i++;
      }
      start = i + 1;
    }
    this.line += text.slice(start);
    return events;
  }

  private take(line: string, events: string[]) {
    if (line === "") {
      // A blank line ends an event; one without data is nothing.
      if (this.data.length) events.push(this.data.join("\n"));
      this.data = [];
      return;
    }
    // A comment (": keep-alive").
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.data.push(value);
  }
}

/** One event's data as a contract event; null for anything else. */
export function parseAssistEvent(data: string): AssistEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return null;
  }
  const parsed = assistEventSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/**
 * The events of a response body, as they arrive. Anything outside the
 * contract is skipped (a stream that then ends without `done` or `error`
 * reads as interrupted). Leaving the loop early cancels the body.
 */
export async function* readAssistEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistEvent> {
  const reader = body.getReader();
  const text = new TextDecoder();
  const decoder = new SseDecoder();
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      const pieces = done
        ? decoder.push(text.decode())
        : decoder.push(text.decode(value, { stream: true }));
      for (const data of pieces) {
        const event = parseAssistEvent(data);
        if (event) yield event;
      }
      if (done) {
        finished = true;
        return;
      }
    }
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
