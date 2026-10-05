import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES } from "@/lib/body-size";
import { assistBodySchemas, assistPath, refusalStatus } from "./protocol";
import {
  isEventStream,
  isSameOrigin,
  readJsonBody,
  refusalOf,
} from "./upstream";

const error = (fieldErrors: Record<string, string[]> = {}) => ({
  error: {
    code: "X",
    messageKey: "errors.x",
    fieldErrors,
    requestId: "r",
    retryable: false,
  },
});

describe("edu-backend's refusals", () => {
  it("map to what the page can act on", () => {
    expect(refusalOf(401, error({ access: ["sign_in"] }))).toBe("signed-out");
    expect(refusalOf(403, error({ access: ["locked"] }))).toBe("forbidden");
    expect(refusalOf(404, error())).toBe("not-found");
    expect(refusalOf(400, error())).toBe("invalid");
    expect(refusalOf(422, error())).toBe("invalid");
    expect(refusalOf(413, undefined)).toBe("too-large");
    expect(refusalOf(429, error({ assist: ["daily_limit"] }))).toBe(
      "daily-limit",
    );
    expect(refusalOf(429, error())).toBe("busy");
    expect(refusalOf(503, error({ assist: ["disabled"] }))).toBe("disabled");
    // The shared daily limit of all readers: not the reader's own, no retry.
    expect(refusalOf(503, error({ assist: ["paused"] }))).toBe("paused");
    expect(refusalOf(503, error({ assist: ["busy"] }))).toBe("busy");
    expect(refusalOf(503, error())).toBe("unavailable");
    expect(refusalOf(500, undefined)).toBe("unavailable");
    expect(refusalOf(502, "<html>")).toBe("unavailable");
  });

  it("answer the browser with matching statuses", () => {
    expect(refusalStatus["daily-limit"]).toBe(429);
    expect(refusalStatus.disabled).toBe(503);
    expect(refusalStatus.paused).toBe(503);
    expect(refusalStatus["too-large"]).toBe(413);
    expect(refusalStatus["signed-out"]).toBe(401);
  });

  it("an answer is an event stream", () => {
    expect(isEventStream("text/event-stream; charset=utf-8")).toBe(true);
    expect(isEventStream("application/json")).toBe(false);
    expect(isEventStream(null)).toBe(false);
  });
});

describe("requests from this app's pages only", () => {
  const app = "https://edu.outegro.dev";
  const headers = (values: Record<string, string>) => new Headers(values);

  it("same Origin, or same-origin fetch metadata without one", () => {
    expect(isSameOrigin(headers({ origin: app }), app)).toBe(true);
    expect(isSameOrigin(headers({ origin: "https://evil.example" }), app)).toBe(
      false,
    );
    expect(
      isSameOrigin(
        headers({ origin: "https://edu.outegro.dev.evil.example" }),
        app,
      ),
    ).toBe(false);
    expect(
      isSameOrigin(headers({ "sec-fetch-site": "same-origin" }), app),
    ).toBe(true);
    expect(isSameOrigin(headers({ "sec-fetch-site": "cross-site" }), app)).toBe(
      false,
    );
    expect(isSameOrigin(headers({}), app)).toBe(false);
  });
});

describe("request bodies", () => {
  const stream = (text: string) =>
    new Response(text).body as ReadableStream<Uint8Array>;

  it("reads JSON up to the limit and tells a larger one from one that is not JSON", async () => {
    expect(await readJsonBody(stream('{"a":1}'), 100)).toEqual({
      kind: "json",
      value: { a: 1 },
    });
    expect(await readJsonBody(stream("x".repeat(200)), 100)).toEqual({
      kind: "too-large",
    });
    expect(await readJsonBody(stream("{not json"), 100)).toEqual({
      kind: "invalid",
    });
    expect(await readJsonBody(null, 100)).toEqual({ kind: "invalid" });
  });

  it("are cut at 96 kB, under edu-backend's 100 kB", async () => {
    const body = (size: number) =>
      stream(JSON.stringify({ text: "x".repeat(size - 11) }));
    expect(MAX_BODY_BYTES).toBe(96 * 1024);
    expect(
      (await readJsonBody(body(MAX_BODY_BYTES), MAX_BODY_BYTES)).kind,
    ).toBe("json");
    expect(
      (await readJsonBody(body(MAX_BODY_BYTES + 1), MAX_BODY_BYTES)).kind,
    ).toBe("too-large");
  });

  it("are checked with the contract's schemas", () => {
    expect(
      assistBodySchemas.explain.safeParse({
        chapter: 1,
        section: "n01-a",
        style: "simpler",
        question: "both at once?",
      }).success,
    ).toBe(false);
    expect(
      assistBodySchemas.understanding.safeParse({ chapter: 1, text: "short" })
        .success,
    ).toBe(false);
    expect(
      assistBodySchemas["sql-hint"].safeParse({
        exerciseId: "s01-t-0000000a",
        sql: "SELECT 1",
        problem: "error",
        detail: "no such table",
      }).success,
    ).toBe(true);
  });

  it("go to a path of this app", () => {
    expect(assistPath("sql-internals", "sql-hint")).toBe(
      "/api/books/sql-internals/assist/sql-hint",
    );
  });
});
