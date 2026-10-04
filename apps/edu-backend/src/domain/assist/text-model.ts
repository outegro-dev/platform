/*
 * The port to a language model that streams text. The MiniMax adapter
 * implements it in production, a scripted fake in tests; nothing outside the
 * adapter knows the provider's HTTP details.
 */

/** Injection token of the TextModel port. */
export const TEXT_MODEL = Symbol("TEXT_MODEL");

export type TextRequest = {
  /** Who the model is and the rules of the answer. */
  readonly system: string;
  /** The material (book text, the reader's writing as data) and the task. */
  readonly prompt: string;
  readonly maxTokens: number;
  /** Let the model think before answering (slower, spends output tokens). */
  readonly thinking: boolean;
};

export type TextChunk =
  /** The next piece of the visible answer. */
  | { readonly type: "text"; readonly text: string }
  /** Token counts reported so far for this call; a field missing is unknown. */
  | {
      readonly type: "usage";
      readonly input?: number;
      readonly output?: number;
    }
  /** The answer is complete; `truncated` when it hit the length limit. */
  | { readonly type: "end"; readonly truncated: boolean };

export interface TextModel {
  /** The model's name, part of what a cached answer depends on. */
  readonly name: string;
  /** False when the provider is not configured (no key): never call it then. */
  readonly configured: boolean;
  /**
   * Streams one answer. Ends normally only after an `end` chunk; a failure
   * is a ModelFailure. Aborting `signal` stops the call.
   */
  stream(request: TextRequest, signal: AbortSignal): AsyncIterable<TextChunk>;
}

/**
 * Why a call failed: `limit` the provider's rate limit or quota, `rejected`
 * the provider refused the credentials, `unavailable` overloaded, 5xx or
 * unreachable, `timeout` no complete answer in time, `invalid` an answer
 * that cannot be read.
 */
export type FailureKind =
  | "limit"
  | "rejected"
  | "unavailable"
  | "timeout"
  | "invalid";

/** A failed call to the model; the message never carries prompts or keys. */
export class ModelFailure extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
    /** Worth one more try when nothing has been streamed yet. */
    readonly retryable = kind === "unavailable",
  ) {
    super(message);
    this.name = "ModelFailure";
  }
}
