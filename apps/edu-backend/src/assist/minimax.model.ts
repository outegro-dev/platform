import { type SseMessage, SseParser } from "../domain/assist/sse-parser.js";
import {
  ModelFailure,
  type TextChunk,
  type TextModel,
  type TextRequest,
} from "../domain/assist/text-model.js";
import { ThinkFilter } from "../domain/assist/think.js";

export type MiniMaxOptions = {
  /** E.g. https://api.minimax.io/anthropic (no trailing slash). */
  baseUrl: string;
  /** Without a key the model is not configured and never called. */
  apiKey: string | undefined;
  model: string;
  /** One call, the whole streamed answer included. */
  timeoutMs: number;
  fetch?: typeof fetch;
};

/** Models that always think and refuse a `thinking` setting. */
const ALWAYS_THINKS = /M3\.1/i;
const LIMIT_TEXT =
  /usage limit|quota|rate.?limit|insufficient (?:balance|credits)|too many requests/i;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const objectAt = (value: unknown, key: string): Json | undefined => {
  const inner = isObject(value) ? value[key] : undefined;
  return isObject(inner) ? inner : undefined;
};
const numberAt = (value: Json | undefined, key: string): number | undefined => {
  const inner = value?.[key];
  return typeof inner === "number" && Number.isFinite(inner) && inner >= 0
    ? Math.round(inner)
    : undefined;
};
const stringAt = (value: Json | undefined, key: string): string | undefined => {
  const inner = value?.[key];
  return typeof inner === "string" ? inner : undefined;
};
/** Input tokens as billed: fresh plus cache writes and reads; undefined if not reported. */
const inputOf = (usage: Json | undefined): number | undefined => {
  const fresh = numberAt(usage, "input_tokens");
  if (fresh === undefined) return undefined;
  return (
    fresh +
    (numberAt(usage, "cache_creation_input_tokens") ?? 0) +
    (numberAt(usage, "cache_read_input_tokens") ?? 0)
  );
};

/** A provider error (`{ type: "error", error: { type, message } }`) as a failure. */
function errorFailure(
  error: Json | undefined,
  status: number | null,
): ModelFailure {
  const type = stringAt(error, "type") ?? "";
  const message = stringAt(error, "message") ?? "";
  const where = status === null ? "stream error" : `HTTP ${status}`;
  // Only the error type goes into the message: provider texts stay out of logs.
  const label = `MiniMax ${where}${type ? ` (${type.slice(0, 60)})` : ""}`;
  if (status === 429 || type === "rate_limit_error" || LIMIT_TEXT.test(message))
    return new ModelFailure("limit", label, false);
  if (
    status === 401 ||
    status === 403 ||
    type === "authentication_error" ||
    type === "permission_error"
  )
    return new ModelFailure("rejected", label, false);
  if (
    (status !== null && (status >= 500 || status === 408)) ||
    type === "overloaded_error" ||
    type === "api_error" ||
    /overloaded/i.test(message) ||
    (status === null && type === "")
  )
    return new ModelFailure("unavailable", label, true);
  return new ModelFailure("invalid", label, false);
}

/**
 * MiniMax through its Anthropic-compatible Messages API, streamed: text
 * deltas are passed on, thinking deltas dropped, `<think>` blocks some models
 * write into the text stripped, token usage reported, `max_tokens` marked as
 * a truncated answer. Failures are ModelFailures by kind: 429 or a quota
 * message is `limit`, 401/403 `rejected`, 5xx/529/overloaded or a broken
 * connection `unavailable`, no answer in time `timeout`.
 */
export class MiniMaxModel implements TextModel {
  readonly name: string;

  constructor(private readonly options: MiniMaxOptions) {
    this.name = options.model;
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async *stream(
    request: TextRequest,
    signal: AbortSignal,
  ): AsyncIterable<TextChunk> {
    const { apiKey, model, baseUrl, timeoutMs } = this.options;
    if (!apiKey)
      throw new ModelFailure("rejected", "MiniMax API key is not set", false);
    const timeout = AbortSignal.timeout(timeoutMs);
    const both = AbortSignal.any([signal, timeout]);
    const failed = (error: unknown) => {
      if (error instanceof ModelFailure) return error;
      if (timeout.aborted && !signal.aborted)
        return new ModelFailure(
          "timeout",
          `MiniMax: no answer in ${timeoutMs} ms`,
          false,
        );
      if (signal.aborted) return error;
      return new ModelFailure("unavailable", "MiniMax is unreachable", true);
    };
    const body = {
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      stream: true,
      ...(ALWAYS_THINKS.test(model)
        ? {}
        : { thinking: { type: request.thinking ? "adaptive" : "disabled" } }),
    };
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        signal: both,
      });
    } catch (error) {
      throw failed(error);
    }
    if (!response.ok || !response.body) {
      let text = "";
      try {
        text = (await response.text()).slice(0, 4000);
      } catch {
        // The status is enough.
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      throw errorFailure(
        objectAt(parsed, "error") ?? { message: text },
        response.ok ? 502 : response.status,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      // A JSON body where a stream was asked for: an error, or not readable.
      const text = await response.text().catch(() => "");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const error = objectAt(parsed, "error");
      if (error) throw errorFailure(error, null);
      throw new ModelFailure(
        "invalid",
        "MiniMax answered without a stream",
        false,
      );
    }

    const parser = new SseParser();
    const think = new ThinkFilter();
    const decoder = new TextDecoder();
    const state = { truncated: false, ended: false };
    const reader = response.body.getReader();
    try {
      for (;;) {
        let read: Awaited<ReturnType<typeof reader.read>>;
        try {
          read = await reader.read();
        } catch (error) {
          throw failed(error);
        }
        const messages = read.done
          ? [...parser.push(decoder.decode()), ...parser.end()]
          : parser.push(decoder.decode(read.value, { stream: true }));
        for (const message of messages) {
          if (state.ended) break;
          yield* this.chunksOf(message, think, state);
        }
        if (read.done || state.ended) break;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (!state.ended)
      throw new ModelFailure(
        "unavailable",
        "MiniMax stream ended before message_stop",
        true,
      );
  }

  private *chunksOf(
    message: SseMessage,
    think: ThinkFilter,
    state: { truncated: boolean; ended: boolean },
  ): Generator<TextChunk> {
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      throw new ModelFailure(
        "invalid",
        "MiniMax sent an unreadable event",
        false,
      );
    }
    if (!isObject(data)) return;
    switch (data.type ?? message.event) {
      case "message_start":
        yield* this.usageOf(objectAt(objectAt(data, "message"), "usage"));
        return;
      case "content_block_start": {
        const block = objectAt(data, "content_block");
        const text = stringAt(block, "text");
        if (stringAt(block, "type") === "text" && text) {
          const visible = think.push(text);
          if (visible) yield { type: "text", text: visible };
        }
        return;
      }
      case "content_block_delta": {
        const delta = objectAt(data, "delta");
        // thinking_delta and signature_delta are the model's reasoning: dropped.
        if (stringAt(delta, "type") !== "text_delta") return;
        const visible = think.push(stringAt(delta, "text") ?? "");
        if (visible) yield { type: "text", text: visible };
        return;
      }
      case "message_delta":
        // Counts here are totals so far, not increments.
        yield* this.usageOf(objectAt(data, "usage"));
        if (stringAt(objectAt(data, "delta"), "stop_reason") === "max_tokens")
          state.truncated = true;
        return;
      case "message_stop": {
        const rest = think.flush();
        if (rest) yield { type: "text", text: rest };
        state.ended = true;
        yield { type: "end", truncated: state.truncated };
        return;
      }
      case "error":
        throw errorFailure(objectAt(data, "error"), null);
      default:
        // ping, content_block_stop and anything newer
        return;
    }
  }

  private *usageOf(usage: Json | undefined): Generator<TextChunk> {
    const input = inputOf(usage);
    const output = numberAt(usage, "output_tokens");
    if (input === undefined && output === undefined) return;
    yield {
      type: "usage",
      ...(input === undefined ? {} : { input }),
      ...(output === undefined ? {} : { output }),
    };
  }
}
