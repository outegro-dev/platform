import type { AssistEvent } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import { parseAssistEvent, readAssistEvents, SseDecoder } from "./sse";

/** A response body that delivers `pieces` one by one, as the network might. */
function body(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const events: AssistEvent[] = [];
  for await (const event of readAssistEvents(stream)) events.push(event);
  return events;
}

const text = (value: string) =>
  `data: ${JSON.stringify({ type: "text", text: value })}\n\n`;
const done = `data: ${JSON.stringify({
  type: "done",
  cached: false,
  truncated: false,
  usedToday: 4,
  dailyLimit: 30,
  score: null,
})}\n\n`;

describe("SseDecoder", () => {
  it("gives the data of every event and skips comments", () => {
    const decoder = new SseDecoder();
    expect(decoder.push(": keep-alive\n\n")).toEqual([]);
    expect(decoder.push("data: one\n\ndata: two\n\n")).toEqual(["one", "two"]);
  });

  it("joins multi-line data and ignores other fields", () => {
    const decoder = new SseDecoder();
    expect(
      decoder.push("event: x\nid: 3\nretry: 10\ndata: a\ndata:b\n\n"),
    ).toEqual(["a\nb"]);
  });

  it("reads events split anywhere, with any line ending", () => {
    const stream = "data: first\r\n\r\ndata: second\r\rdata: third\n\n";
    for (let size = 1; size <= stream.length; size++) {
      const decoder = new SseDecoder();
      const events: string[] = [];
      for (let i = 0; i < stream.length; i += size)
        events.push(...decoder.push(stream.slice(i, i + size)));
      expect(events, `pieces of ${size}`).toEqual(["first", "second", "third"]);
    }
  });

  it("keeps an event without its blank line until it comes", () => {
    const decoder = new SseDecoder();
    expect(decoder.push("data: half")).toEqual([]);
    expect(decoder.push("way\n")).toEqual([]);
    expect(decoder.push("\n")).toEqual(["halfway"]);
  });
});

describe("assistant events", () => {
  it("accepts only the contract's events", () => {
    expect(parseAssistEvent('{"type":"text","text":"a"}')).toEqual({
      type: "text",
      text: "a",
    });
    expect(parseAssistEvent("not json")).toBeNull();
    expect(parseAssistEvent('{"type":"html","html":"<b>"}')).toBeNull();
    expect(parseAssistEvent('{"type":"done"}')).toBeNull();
  });

  it("reads a response body: keep-alives skipped, pieces in order, done last", async () => {
    const stream = `: keep-alive\n\n${text("Event ")}${text("loop")}${done}`;
    const events = await collect(body([stream.slice(0, 7), stream.slice(7)]));
    expect(events.map((event) => event.type)).toEqual(["text", "text", "done"]);
    expect(events[1]).toEqual({ type: "text", text: "loop" });
  });

  it("splits multi-byte characters between pieces correctly", async () => {
    const bytes = new TextEncoder().encode(text("Привет — мир"));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual([
      { type: "text", text: "Привет — мир" },
    ]);
  });

  it("skips what is outside the contract and stops at the end", async () => {
    const events = await collect(
      body([`data: {"type":"text"}\n\n`, text("ok"), "data: unfinished"]),
    );
    expect(events).toEqual([{ type: "text", text: "ok" }]);
  });

  it("leaving the loop early cancels the body", async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(text("again")));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of readAssistEvents(stream)) break;
    expect(cancelled).toBe(true);
  });
});
