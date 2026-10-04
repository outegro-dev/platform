import type { AssistEvent } from "@outegro/contracts/edu";
import { makeAutoObservable, runInAction } from "mobx";
import type {
  AssistBodies,
  AssistKind,
  AssistRefusal,
} from "@/lib/assist/protocol";
import type { AssistTransport } from "@/lib/assist/transport";
import type { AssistStore } from "./assist-store";

/** Where one answer stands. */
export type AnswerPhase =
  | "idle"
  /** Asked; nothing has come yet (the model may think for a while). */
  | "waiting"
  /** The answer is coming in. */
  | "streaming"
  | "done"
  /** The reader stopped it: what came so far stays. */
  | "stopped"
  /** It failed: what came so far stays, with why. */
  | "failed";

/** Why an answer failed, as the reader is told. */
export type AnswerFailure =
  /** Today's answers are used up (429). */
  | { kind: "daily-limit" }
  /** The day's answers of all readers are used up: back tomorrow (503 paused). */
  | { kind: "paused" }
  /** The request is larger than the assistant takes: it is not sent. */
  | { kind: "too-large" }
  /** The assistant did not answer, or broke off; `retryable`: worth trying again. */
  | { kind: "unavailable"; retryable: boolean }
  /** The browser is offline. */
  | { kind: "offline" }
  /** The session ended: sign in again. */
  | { kind: "signed-out" }
  /** The chapter is no longer open to the reader (or the account is suspended). */
  | { kind: "forbidden" }
  /** The section or the task is not there any more: the page is out of date. */
  | { kind: "not-found" }
  /** The request was refused as it is. */
  | { kind: "invalid" };

export type DoneEvent = Extract<AssistEvent, { type: "done" }>;
type ErrorEvent = Extract<AssistEvent, { type: "error" }>;
/** Called once with a complete answer's `done`. */
export type OnDone = (done: DoneEvent) => void;

type Deps = {
  slug: string;
  transport: AssistTransport;
  assist: AssistStore;
  isOnline: () => boolean;
  /** A complete answer, once (the understanding check records its score). */
  onDone?: OnDone;
};

const retryable = (failure: AnswerFailure | null) =>
  failure?.kind === "offline" ||
  (failure?.kind === "unavailable" && failure.retryable);

function failureOfRefusal(reason: AssistRefusal): AnswerFailure {
  switch (reason) {
    case "daily-limit":
    case "paused":
    case "too-large":
    case "signed-out":
    case "forbidden":
    case "not-found":
    case "invalid":
      return { kind: reason };
    case "disabled":
      return { kind: "unavailable", retryable: false };
    default:
      // busy (every model slot taken) and unavailable: worth another try.
      return { kind: "unavailable", retryable: true };
  }
}

function failureOfEvent(event: ErrorEvent): AnswerFailure {
  // RATE_LIMITED here is the provider's limit, not the reader's: like a
  // failed or timed-out model, the assistant is not answering right now.
  return { kind: "unavailable", retryable: event.retryable };
}

/**
 * One answer of the assistant as it streams: waiting, the text growing,
 * then done (maybe cut at the length limit), stopped by the reader, or
 * failed and why. A new request drops the one still coming (its late
 * events change nothing); a retry sends the last request again. The
 * transport is injected, so the store runs on a script in tests.
 */
export class AnswerStore<K extends AssistKind> {
  phase: AnswerPhase = "idle";
  text = "";
  truncated = false;
  /** The understanding check's 1–10 score, once done. */
  score: number | null = null;
  failure: AnswerFailure | null = null;
  readonly kind: K;
  private request: AssistBodies[K] | null = null;
  private controller: AbortController | null = null;
  private sequence = 0;
  private readonly deps: Deps;

  constructor(kind: K, deps: Deps) {
    this.kind = kind;
    this.deps = deps;
    makeAutoObservable<this, "request" | "controller" | "sequence" | "deps">(
      this,
      {
        kind: false,
        request: false,
        controller: false,
        sequence: false,
        deps: false,
      },
      { autoBind: true },
    );
  }

  /** Asked and not finished: waiting for the first words, or receiving them. */
  get running(): boolean {
    return this.phase === "waiting" || this.phase === "streaming";
  }

  /** Something was asked: the answer's place is on the page. */
  get started(): boolean {
    return this.phase !== "idle";
  }

  get canRetry(): boolean {
    return this.phase === "failed" && retryable(this.failure);
  }

  /** Asks for a new answer; one still coming is dropped first. */
  async ask(body: AssistBodies[K]): Promise<void> {
    this.cancel();
    const run = ++this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    this.request = body;
    this.phase = "waiting";
    this.text = "";
    this.truncated = false;
    this.score = null;
    this.failure = null;
    if (!this.deps.isOnline()) {
      this.fail({ kind: "offline" });
      return;
    }
    const current = () => run === this.sequence;
    try {
      const reply = await this.deps.transport.ask(
        this.deps.slug,
        this.kind,
        body,
        controller.signal,
      );
      if (!current()) return;
      if (reply.kind !== "stream") {
        runInAction(() =>
          reply.kind === "refused"
            ? this.refused(reply.reason)
            : this.fail(this.connectionFailure()),
        );
        return;
      }
      for await (const event of reply.events) {
        if (!current()) return;
        runInAction(() => this.take(event));
        if (event.type !== "text") return;
      }
      // Neither done nor error: the stream was cut off on its way.
      runInAction(() => {
        if (current() && this.running)
          this.fail({ kind: "unavailable", retryable: true });
      });
    } catch {
      // Stopped, replaced or left (an abort), or the connection broke.
      runInAction(() => {
        if (current() && this.running) this.fail(this.connectionFailure());
      });
    }
  }

  /** The reader stops the answer: what came so far stays. */
  stop() {
    if (!this.running) return;
    const spoke = this.text.length > 0;
    this.cancel();
    this.phase = "stopped";
    if (spoke) this.deps.assist.spent();
  }

  /** Sends the last request again, when that may help. */
  retry() {
    if (this.request && this.canRetry) void this.ask(this.request);
  }

  /** Back to nothing asked (a new SQL check); a running answer is dropped. */
  reset() {
    this.cancel();
    this.request = null;
    this.phase = "idle";
    this.text = "";
    this.truncated = false;
    this.score = null;
    this.failure = null;
  }

  /** The page or the helper goes away: drop what is coming, quietly. */
  dispose() {
    this.cancel();
  }

  private cancel() {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
  }

  private take(event: AssistEvent) {
    switch (event.type) {
      case "text":
        this.text += event.text;
        this.phase = "streaming";
        return;
      case "done":
        this.truncated = event.truncated;
        this.score = event.score;
        this.phase = "done";
        this.controller = null;
        this.deps.assist.answered({
          usedToday: event.usedToday,
          dailyLimit: event.dailyLimit,
        });
        this.deps.onDone?.(event);
        return;
      case "error":
        this.fail(failureOfEvent(event));
    }
  }

  private refused(reason: AssistRefusal) {
    if (reason === "disabled") this.deps.assist.disable();
    if (reason === "daily-limit") this.deps.assist.limitReached();
    this.fail(failureOfRefusal(reason));
  }

  private fail(failure: AnswerFailure) {
    // Words already shown were counted by edu-backend.
    if (this.text.length > 0 && this.running) this.deps.assist.spent();
    this.failure = failure;
    this.phase = "failed";
    this.controller = null;
  }

  private connectionFailure(): AnswerFailure {
    return this.deps.isOnline()
      ? { kind: "unavailable", retryable: true }
      : { kind: "offline" };
  }
}
