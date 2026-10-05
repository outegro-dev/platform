import {
  type FailureKind,
  ModelFailure,
  type TextModel,
  type TextRequest,
} from "./text-model.js";

/** How an answer ended: as stored (`ok`, `failed`, `refused`), and why not ok. */
export type RelayResult = {
  readonly outcome: "ok" | "failed" | "refused";
  /** Why the answer is not complete; null when it is. */
  readonly reason: FailureKind | "aborted" | null;
  /** Everything the reader received. */
  readonly text: string;
  readonly truncated: boolean;
  /** Summed over the calls made (a retry is a second call). */
  readonly tokensIn: number;
  readonly tokensOut: number;
  /** An error the model threw that is not a ModelFailure (a bug): for the log. */
  readonly unexpected?: unknown;
};

/** The reader got part of the answer: it counts against the daily limit. */
export const isCharged = (result: Pick<RelayResult, "outcome">) =>
  result.outcome !== "refused";

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });

/**
 * Streams one answer from the model to `onText`. A call that fails before
 * the first words is tried once more when the failure is worth it
 * (overloaded, 5xx, unreachable); once the reader has text, a failure ends
 * the answer as it is. Never throws: every way it ends is a RelayResult.
 */
export async function relayAnswer(
  model: TextModel,
  request: TextRequest,
  onText: (text: string) => void,
  signal: AbortSignal,
  options: { retryDelayMs?: number } = {},
): Promise<RelayResult> {
  let text = "";
  let truncated = false;
  let tokensIn = 0;
  let tokensOut = 0;
  let unexpected: unknown;
  const finish = (reason: RelayResult["reason"]): RelayResult => {
    const received = text.trim() !== "";
    return {
      outcome:
        reason === null && received ? "ok" : received ? "failed" : "refused",
      // A complete answer without a single word is no answer.
      reason: reason ?? (received ? null : "invalid"),
      text,
      truncated,
      tokensIn,
      tokensOut,
      ...(unexpected === undefined ? {} : { unexpected }),
    };
  };
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) return finish("aborted");
    // Token counts are reported per call; a retried call adds its own.
    let callIn = 0;
    let callOut = 0;
    try {
      let ended = false;
      for await (const chunk of model.stream(request, signal)) {
        if (chunk.type === "text") {
          if (!chunk.text) continue;
          text += chunk.text;
          onText(chunk.text);
        } else if (chunk.type === "usage") {
          callIn = chunk.input ?? callIn;
          callOut = chunk.output ?? callOut;
        } else {
          truncated = chunk.truncated;
          ended = true;
        }
      }
      tokensIn += callIn;
      tokensOut += callOut;
      if (signal.aborted) return finish("aborted");
      return finish(ended ? null : "invalid");
    } catch (error) {
      tokensIn += callIn;
      tokensOut += callOut;
      if (signal.aborted) return finish("aborted");
      if (!(error instanceof ModelFailure)) {
        unexpected = error;
        return finish("invalid");
      }
      if (error.retryable && !text && attempt === 0) {
        await wait(options.retryDelayMs ?? 0, signal);
        continue;
      }
      return finish(error.kind);
    }
  }
}
