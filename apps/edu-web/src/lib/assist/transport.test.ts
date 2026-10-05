import type { AssistEvent } from "@outegro/contracts/edu";
import { describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "@/lib/body-size";
import { fetchTransport } from "./transport";

const body = { chapter: 1, section: "n01-a", style: "simpler" as const };

function eventStream(...events: AssistEvent[]) {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

describe("fetchTransport", () => {
  it("posts the body to this app's route handler, same origin", async () => {
    const fetcher = vi.fn(async () => eventStream({ type: "text", text: "a" }));
    const transport = fetchTransport(fetcher as unknown as typeof fetch);
    const signal = new AbortController().signal;
    const reply = await transport.ask(
      "nodejs-internals",
      "explain",
      body,
      signal,
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/books/nodejs-internals/assist/explain",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
        credentials: "same-origin",
        signal,
      }),
    );
    expect(reply.kind).toBe("stream");
    if (reply.kind !== "stream") return;
    const events: AssistEvent[] = [];
    for await (const event of reply.events) events.push(event);
    expect(events).toEqual([{ type: "text", text: "a" }]);
  });

  it("reads the BFF's refusals; anything else is unavailable", async () => {
    const answer = (response: Response) =>
      fetchTransport((async () => response) as unknown as typeof fetch).ask(
        "x",
        "understanding",
        { chapter: 1, text: "t" },
        new AbortController().signal,
      );
    expect(
      await answer(Response.json({ refusal: "daily-limit" }, { status: 429 })),
    ).toEqual({ kind: "refused", reason: "daily-limit" });
    expect(
      await answer(new Response("<html>Bad gateway</html>", { status: 502 })),
    ).toEqual({ kind: "refused", reason: "unavailable" });
    expect(
      await answer(Response.json({ refusal: "nonsense" }, { status: 400 })),
    ).toEqual({ kind: "refused", reason: "unavailable" });
    // A 200 that is not an event stream is not an answer.
    expect(await answer(Response.json({ ok: true }))).toEqual({
      kind: "refused",
      reason: "unavailable",
    });
  });

  it("does not send a body larger than edu-backend takes: too large, for good", async () => {
    const fetcher = vi.fn(async () => eventStream({ type: "text", text: "a" }));
    const transport = fetchTransport(fetcher as unknown as typeof fetch);
    const reply = await transport.ask(
      "nodejs-internals",
      "understanding",
      { chapter: 1, text: "я".repeat(MAX_BODY_BYTES / 2) },
      new AbortController().signal,
    );
    expect(reply).toEqual({ kind: "refused", reason: "too-large" });
    expect(fetcher).not.toHaveBeenCalled();
    // The BFF's own refusal of one reads the same.
    const refused = await fetchTransport((async () =>
      Response.json(
        { refusal: "too-large" },
        { status: 413 },
      )) as unknown as typeof fetch).ask(
      "x",
      "explain",
      body,
      new AbortController().signal,
    );
    expect(refused).toEqual({ kind: "refused", reason: "too-large" });
  });

  it("a failed connection is network; an abort is the caller's own", async () => {
    const failing = fetchTransport((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect(
      await failing.ask("x", "explain", body, new AbortController().signal),
    ).toEqual({ kind: "network" });
    const controller = new AbortController();
    controller.abort();
    const aborted = fetchTransport((async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch);
    await expect(
      aborted.ask("x", "explain", body, controller.signal),
    ).rejects.toThrow("aborted");
  });
});
