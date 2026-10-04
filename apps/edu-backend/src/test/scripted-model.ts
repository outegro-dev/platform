import {
  type FailureKind,
  ModelFailure,
  type TextChunk,
  type TextModel,
  type TextRequest,
} from "../domain/assist/text-model.js";

/**
 * One step of a scripted call: a piece of text, token usage, a failure, a
 * pause until a promise settles, or a wait until the caller aborts.
 */
export type Step =
  | { text: string }
  | { usage: { input?: number; output?: number } }
  | { fail: FailureKind; retryable?: boolean }
  | { wait: Promise<unknown> }
  | { hang: true }
  | { truncated: true };

/** The steps of one call; it ends with `end` unless a step fails or hangs. */
export type Script = Step[];

/** A promise the test resolves itself: a gate a scripted call waits at. */
export function gate() {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const abortError = () =>
  Object.assign(new Error("The operation was aborted"), { name: "AbortError" });

const abortedSignal = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

/**
 * The language model in tests: answers follow scripts queued by the test
 * (one per call, the default answer when none is queued), and every call is
 * recorded with its request and abort signal. It never leaves the process.
 */
export class ScriptedModel implements TextModel {
  readonly name = "scripted-model";
  configured = true;
  readonly calls: { request: TextRequest; signal: AbortSignal }[] = [];
  /** The answer of a call no script was queued for. */
  fallback: Script = [
    { usage: { input: 120 } },
    { text: "Короткий " },
    { text: "ответ." },
    { usage: { output: 30 } },
  ];
  private readonly queued: Script[] = [];

  script(...scripts: Script[]) {
    this.queued.push(...scripts);
  }

  reset() {
    this.queued.length = 0;
    this.calls.length = 0;
  }

  /** The request of the n-th call (0-based; negative counts from the end). */
  request(n = -1): TextRequest {
    const call = this.calls.at(n);
    if (!call) throw new Error(`no call ${n} of ${this.calls.length}`);
    return call.request;
  }

  async *stream(
    request: TextRequest,
    signal: AbortSignal,
  ): AsyncIterable<TextChunk> {
    this.calls.push({ request, signal });
    const steps = this.queued.shift() ?? this.fallback;
    let truncated = false;
    for (const step of steps) {
      if (signal.aborted) throw abortError();
      if ("text" in step) yield { type: "text", text: step.text };
      else if ("usage" in step) yield { type: "usage", ...step.usage };
      else if ("fail" in step)
        throw new ModelFailure(
          step.fail,
          `scripted ${step.fail}`,
          step.retryable ?? step.fail === "unavailable",
        );
      else if ("wait" in step)
        await Promise.race([step.wait, abortedSignal(signal)]);
      else if ("hang" in step) {
        await abortedSignal(signal);
        throw abortError();
      } else truncated = true;
    }
    if (signal.aborted) throw abortError();
    yield { type: "end", truncated };
  }
}
