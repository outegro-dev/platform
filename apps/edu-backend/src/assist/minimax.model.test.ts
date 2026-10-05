import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ModelFailure,
  type TextChunk,
  type TextRequest,
} from "../domain/assist/text-model.js";
import { MiniMaxModel } from "./minimax.model.js";

/**
 * The real MiniMax adapter against a local stub (never the real API): the
 * request it sends, and how it reads the Anthropic-style stream as MiniMax
 * sends it (checked live by the owner on MiniMax-M3: message_start with
 * input 0 and cache reads, a ping, a thinking block before the text when
 * thinking is on, the real usage in message_delta).
 */

type Seen = { url: string; headers: IncomingMessage["headers"]; body: string };
type Handler = (res: ServerResponse) => void | Promise<void>;

const API_KEY = "minimax-test-key-5c1e";
const seen: Seen[] = [];
let handlers: Handler[] = [];
let base = "";

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    seen.push({
      url: req.url ?? "",
      headers: req.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    const handler = handlers.shift();
    if (!handler) {
      res.writeHead(500).end();
      return;
    }
    void handler(res);
  });
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/anthropic`;
});
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);

const model = (options: { timeoutMs?: number; model?: string } = {}) =>
  new MiniMaxModel({
    baseUrl: base,
    apiKey: API_KEY,
    model: options.model ?? "MiniMax-M3",
    timeoutMs: options.timeoutMs ?? 5_000,
  });

const request: TextRequest = {
  system: "Ты — наставник.",
  prompt: "Объясни.",
  maxTokens: 1800,
  thinking: false,
};

const event = (type: string, data: object) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

/** The stream as MiniMax-M3 sends it with thinking on. */
const liveLike = [
  event("message_start", {
    message: {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "MiniMax-M3",
      content: [],
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 191,
      },
    },
  }),
  event("ping", {}),
  event("content_block_start", {
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  }),
  event("content_block_delta", {
    index: 0,
    delta: { type: "thinking_delta", thinking: "Сначала подумаю: секрет" },
  }),
  event("content_block_delta", {
    index: 0,
    delta: { type: "signature_delta", signature: "sig" },
  }),
  event("content_block_stop", { index: 0 }),
  event("content_block_start", {
    index: 1,
    content_block: { type: "text", text: "" },
  }),
  event("content_block_delta", {
    index: 1,
    delta: { type: "text_delta", text: "<think>и тут секрет</th" },
  }),
  event("content_block_delta", {
    index: 1,
    delta: { type: "text_delta", text: "ink>\n\nNode.js — " },
  }),
  event("content_block_delta", {
    index: 1,
    delta: { type: "text_delta", text: "это **среда выполнения**." },
  }),
  event("content_block_stop", { index: 1 }),
  event("message_delta", {
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: {
      input_tokens: 46,
      output_tokens: 103,
      cache_read_input_tokens: 145,
      cache_creation_input_tokens: 5,
    },
  }),
  event("message_stop", {}),
].join("");

/** Writes the text in pieces of `size` bytes, cutting events and tags apart. */
const streamed =
  (text: string, size = 7, contentType = "text/event-stream") =>
  async (res: ServerResponse) => {
    res.writeHead(200, { "content-type": contentType });
    const bytes = Buffer.from(text, "utf8");
    for (let i = 0; i < bytes.length; i += size) {
      res.write(bytes.subarray(i, i + size));
      await new Promise((resolve) => setImmediate(resolve));
    }
    res.end();
  };

const json =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (res: ServerResponse) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };

async function collect(
  run: AsyncIterable<TextChunk>,
): Promise<{ chunks: TextChunk[]; error: unknown }> {
  const chunks: TextChunk[] = [];
  try {
    for await (const chunk of run) chunks.push(chunk);
    return { chunks, error: null };
  } catch (error) {
    return { chunks, error };
  }
}

const textOf = (chunks: TextChunk[]) =>
  chunks.map((chunk) => (chunk.type === "text" ? chunk.text : "")).join("");

describe("MiniMax adapter", () => {
  it("sends one streamed Messages API call with the key as a bearer token", async () => {
    handlers = [streamed(liveLike)];
    seen.length = 0;
    await collect(model().stream(request, new AbortController().signal));
    expect(seen).toHaveLength(1);
    const [call] = seen;
    expect(call?.url).toBe("/anthropic/v1/messages");
    expect(call?.headers).toMatchObject({
      authorization: `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(JSON.parse(call?.body ?? "{}")).toEqual({
      model: "MiniMax-M3",
      max_tokens: 1800,
      system: "Ты — наставник.",
      messages: [{ role: "user", content: "Объясни." }],
      stream: true,
      thinking: { type: "disabled" },
    });
    handlers = [streamed(liveLike)];
    await collect(
      model().stream(
        { ...request, thinking: true },
        new AbortController().signal,
      ),
    );
    expect(JSON.parse(seen[1]?.body ?? "{}").thinking).toEqual({
      type: "adaptive",
    });
    // A model that always thinks gets no thinking setting at all.
    handlers = [streamed(liveLike)];
    await collect(
      model({ model: "MiniMax-M3.1" }).stream(
        request,
        new AbortController().signal,
      ),
    );
    expect(JSON.parse(seen[2]?.body ?? "{}")).not.toHaveProperty("thinking");
  });

  it("passes text on, drops thinking and <think>, reports usage from message_delta", async () => {
    for (const size of [1, 7, 64, 10_000]) {
      handlers = [streamed(liveLike, size)];
      const { chunks, error } = await collect(
        model().stream(request, new AbortController().signal),
      );
      expect([size, error]).toEqual([size, null]);
      expect(textOf(chunks)).toBe("Node.js — это **среда выполнения**.");
      expect(JSON.stringify(chunks)).not.toContain("секрет");
      const usage = chunks.filter((chunk) => chunk.type === "usage");
      // message_start first (input 0 + 191 cache reads), then the real totals.
      expect(usage.at(0)).toEqual({ type: "usage", input: 191, output: 0 });
      expect(usage.at(-1)).toEqual({ type: "usage", input: 196, output: 103 });
      expect(chunks.at(-1)).toEqual({ type: "end", truncated: false });
    }
  });

  it("marks an answer cut at max_tokens as truncated", async () => {
    handlers = [
      streamed(
        [
          event("message_start", { message: { usage: { input_tokens: 10 } } }),
          event("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: "Длинный ответ…" },
          }),
          event("message_delta", {
            delta: { stop_reason: "max_tokens" },
            usage: { output_tokens: 1800 },
          }),
          event("message_stop", {}),
        ].join(""),
      ),
    ];
    const { chunks } = await collect(
      model().stream(request, new AbortController().signal),
    );
    expect(chunks.at(-1)).toEqual({ type: "end", truncated: true });
    expect(chunks.filter((chunk) => chunk.type === "usage").at(-1)).toEqual({
      type: "usage",
      output: 1800,
    });
  });

  it("maps refusals and outages to failure kinds without provider text", async () => {
    const cases: [Handler, string, boolean][] = [
      [
        json(429, {
          type: "error",
          error: { type: "rate_limit_error", message: "slow down" },
        }),
        "limit",
        false,
      ],
      [
        json(400, {
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "usage limit exceeded for plan",
          },
        }),
        "limit",
        false,
      ],
      [
        json(401, {
          type: "error",
          error: { type: "authentication_error", message: "bad key" },
        }),
        "rejected",
        false,
      ],
      [
        json(403, { type: "error", error: { type: "permission_error" } }),
        "rejected",
        false,
      ],
      [
        json(529, {
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
        "unavailable",
        true,
      ],
      [json(503, { message: "upstream down" }), "unavailable", true],
      [
        json(400, {
          type: "error",
          error: { type: "invalid_request_error", message: "bad model" },
        }),
        "invalid",
        false,
      ],
      [
        streamed(
          event("error", {
            error: { type: "overloaded_error", message: "Overloaded" },
          }),
        ),
        "unavailable",
        true,
      ],
      [
        streamed(event("error", { error: { type: "rate_limit_error" } })),
        "limit",
        false,
      ],
      [streamed("data: {not json}\n\n"), "invalid", false],
      [
        json(200, { type: "error", error: { type: "api_error" } }),
        "unavailable",
        true,
      ],
      [json(200, { id: "msg", content: [] }), "invalid", false],
      // The stream broke off before message_stop.
      [
        streamed(
          event("message_start", { message: { usage: { input_tokens: 3 } } }),
        ),
        "unavailable",
        true,
      ],
    ];
    for (const [handler, kind, retryable] of cases) {
      handlers = [handler];
      const { error } = await collect(
        model().stream(request, new AbortController().signal),
      );
      expect(error).toBeInstanceOf(ModelFailure);
      const failure = error as ModelFailure;
      expect([kind, failure.kind, failure.retryable]).toEqual([
        kind,
        kind,
        retryable,
      ]);
      for (const secret of [
        "slow down",
        "bad key",
        "upstream down",
        "bad model",
        API_KEY,
      ])
        expect(failure.message).not.toContain(secret);
    }
  });

  it("is unreachable, out of time or stopped by the caller", async () => {
    const closed = new MiniMaxModel({
      baseUrl: "http://127.0.0.1:9",
      apiKey: API_KEY,
      model: "MiniMax-M3",
      timeoutMs: 5_000,
    });
    const unreachable = await collect(
      closed.stream(request, new AbortController().signal),
    );
    expect(unreachable.error).toMatchObject({
      kind: "unavailable",
      retryable: true,
    });

    // Headers, then silence: the call's own timeout ends it.
    handlers = [
      (res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          event("message_start", { message: { usage: { input_tokens: 1 } } }),
        );
      },
    ];
    const slow = await collect(
      model({ timeoutMs: 300 }).stream(request, new AbortController().signal),
    );
    expect(slow.error).toMatchObject({ kind: "timeout", retryable: false });

    handlers = [
      (res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(
          event("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: "Начало" },
          }),
        );
      },
    ];
    const controller = new AbortController();
    const chunks: TextChunk[] = [];
    let stopped: unknown = null;
    try {
      for await (const chunk of model().stream(request, controller.signal)) {
        chunks.push(chunk);
        controller.abort();
      }
    } catch (error) {
      stopped = error;
    }
    expect(textOf(chunks)).toBe("Начало");
    // The caller's own abort is not a provider failure.
    expect(stopped).not.toBeInstanceOf(ModelFailure);
    expect(stopped).toBeTruthy();
  });

  it("refuses to call without a key", async () => {
    const keyless = new MiniMaxModel({
      baseUrl: base,
      apiKey: undefined,
      model: "MiniMax-M3",
      timeoutMs: 1_000,
    });
    expect(keyless.configured).toBe(false);
    expect(model().configured).toBe(true);
    seen.length = 0;
    const { error } = await collect(
      keyless.stream(request, new AbortController().signal),
    );
    expect(error).toMatchObject({ kind: "rejected" });
    expect(seen).toHaveLength(0);
  });
});
