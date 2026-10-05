import { Inject, Injectable, Logger } from "@nestjs/common";
import { messageKeyFor } from "@outegro/contracts";
import { type AssistEvent, assistEventSchema } from "@outegro/contracts/edu";
import { AppError } from "@outegro/nest-common";
import { loggableError } from "../common/loggable-error.js";
import { EduMetrics } from "../common/metrics.js";
import { type RelayResult, relayAnswer } from "../domain/assist/relay.js";
import { NoSlot, Slots } from "../domain/assist/slots.js";
import {
  TEXT_MODEL,
  type TextModel,
  type TextRequest,
} from "../domain/assist/text-model.js";
import { type AssistJob, AssistLedger } from "./ledger.js";
import {
  ASSIST_TIMING,
  AssistSettings,
  type AssistTiming,
} from "./settings.js";

type ErrorEvent = Extract<AssistEvent, { type: "error" }>;
export type AssistEmit = (event: AssistEvent) => void;

/** What a complete answer leaves behind (a cached copy, a score): the score for `done`. */
export type OnComplete = (result: RelayResult) => Promise<number | null>;
/** What serving a cached answer leaves behind (the reader's activity). */
export type OnServed = () => Promise<void>;

/**
 * An answer ready to stream: every check passed, the model slot and the
 * reader's daily answer taken (or nothing to send: the reader left before
 * it could start). Streaming never throws; whatever happens after the
 * response started is an `error` event.
 */
export interface AssistAnswer {
  stream(emit: AssistEmit, signal: AbortSignal): Promise<void>;
  /** Frees what the answer holds if it was never streamed; harmless after. */
  dispose(): Promise<void>;
}

const errorEvent = (code: ErrorEvent["code"], retryable: boolean): ErrorEvent =>
  assistEventSchema.parse({
    type: "error",
    code,
    messageKey: messageKeyFor(code),
    retryable,
  }) as ErrorEvent;

/** What the reader is told when the answer stopped for this reason. */
export function failureEvent(reason: RelayResult["reason"]): ErrorEvent {
  switch (reason) {
    case "limit":
      return errorEvent("RATE_LIMITED", true);
    case "rejected":
      return errorEvent("DEPENDENCY_UNAVAILABLE", false);
    case "unavailable":
    case "timeout":
    case "invalid":
      return errorEvent("DEPENDENCY_UNAVAILABLE", true);
    default:
      return errorEvent("INTERNAL", false);
  }
}

/*
 * Errors here are logged as `loggableError` has them, by kind alone: around
 * an answer, an error's message or fields may hold the model's text or the
 * reader's words, and prompts and answers never reach the log.
 */
const logger = new Logger("Assistant");

/** The reader left before the answer could start: nothing to send, nothing held. */
const abandoned: AssistAnswer = {
  async stream() {},
  async dispose() {},
};

/** An answer from the cache: one text event; it does not count against the limit. */
class CachedAnswer implements AssistAnswer {
  constructor(
    private readonly job: AssistJob,
    private readonly text: string,
    private readonly onServed: OnServed,
    private readonly ledger: AssistLedger,
    private readonly metrics: EduMetrics,
    private readonly dailyLimit: number,
  ) {}

  async stream(emit: AssistEmit): Promise<void> {
    try {
      await this.ledger.recordCached(this.job);
      await this.onServed();
      const usedToday = await this.ledger.usedToday(this.job.userId);
      this.metrics.assistRequest(this.job.kind, "cached");
      emit({ type: "text", text: this.text });
      emit({
        type: "done",
        cached: true,
        truncated: false,
        usedToday,
        dailyLimit: this.dailyLimit,
        score: null,
      });
    } catch (error) {
      logger.error(
        { error: loggableError(error), kind: this.job.kind },
        "Cached answer failed",
      );
      emit(failureEvent(null));
    }
  }

  async dispose(): Promise<void> {}
}

/** An answer from the model, relayed as it comes. */
class ModelAnswer implements AssistAnswer {
  private started = false;

  constructor(
    private readonly deps: {
      model: TextModel;
      ledger: AssistLedger;
      metrics: EduMetrics;
      retryDelayMs: number;
      dailyLimit: number;
    },
    private readonly job: AssistJob,
    private readonly request: TextRequest,
    private readonly reservation: string,
    private readonly release: () => void,
    private readonly onComplete: OnComplete,
  ) {}

  async stream(emit: AssistEmit, signal: AbortSignal): Promise<void> {
    if (this.started) return;
    this.started = true;
    const { model, ledger, metrics, retryDelayMs, dailyLimit } = this.deps;
    const { kind } = this.job;
    try {
      const result = await relayAnswer(
        model,
        this.request,
        (text) => emit({ type: "text", text }),
        signal,
        { retryDelayMs },
      );
      // The model is done: the next request may have the slot.
      this.release();
      if (result.unexpected !== undefined)
        logger.error(
          { error: loggableError(result.unexpected), kind },
          "Model adapter failed",
        );
      await ledger.settle(this.reservation, result);
      metrics.assistTokensSpent(result.tokensIn, result.tokensOut);
      metrics.assistRequest(
        kind,
        result.reason === "aborted" ? "aborted" : result.outcome,
      );
      // Counts and reasons only: prompts and answers never reach the log.
      logger.log(
        {
          kind,
          outcome: result.outcome,
          reason: result.reason,
          truncated: result.truncated,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
        },
        "Assistant answered",
      );
      if (result.outcome !== "ok") {
        if (result.reason !== "aborted") emit(failureEvent(result.reason));
        return;
      }
      const score = await this.onComplete(result);
      emit({
        type: "done",
        cached: false,
        truncated: result.truncated,
        usedToday: await ledger.usedToday(this.job.userId),
        dailyLimit,
        score,
      });
    } catch (error) {
      logger.error(
        { error: loggableError(error), kind },
        "Assistant answer failed",
      );
      emit(failureEvent(null));
    } finally {
      this.release();
    }
  }

  async dispose(): Promise<void> {
    this.release();
    if (this.started) return;
    this.started = true;
    // Never streamed: the reader got nothing, the answer is not counted.
    await this.deps.ledger
      .settle(this.reservation, {
        outcome: "refused",
        tokensIn: 0,
        tokensOut: 0,
      })
      .catch((error: unknown) =>
        logger.error(
          { error: loggableError(error), kind: this.job.kind },
          "Unused answer could not be settled",
        ),
      );
  }
}

/**
 * Makes answers: from the cache, or from the model once the reader has an
 * answer left today, the day's answers of all readers are not spent and a
 * model slot is free (503 after waiting for one).
 */
@Injectable()
export class AssistAnswers {
  constructor(
    @Inject(TEXT_MODEL) private readonly model: TextModel,
    @Inject(ASSIST_TIMING) private readonly timing: AssistTiming,
    private readonly slots: Slots,
    private readonly ledger: AssistLedger,
    private readonly metrics: EduMetrics,
    private readonly settings: AssistSettings,
  ) {}

  get modelName(): string {
    return this.model.name;
  }

  cached(job: AssistJob, text: string, onServed: OnServed): AssistAnswer {
    return new CachedAnswer(
      job,
      text,
      onServed,
      this.ledger,
      this.metrics,
      this.settings.dailyLimit,
    );
  }

  /**
   * 429 without answers left today, 503 once the day's answers of all
   * readers are spent (paused) and without a free model slot in time
   * (busy). A reader who leaves while waiting for a slot gets nothing and
   * is no failure: an answer that sends nothing, counted as aborted.
   */
  async fromModel(
    job: AssistJob,
    request: TextRequest,
    signal: AbortSignal,
    onComplete: OnComplete,
  ): Promise<AssistAnswer> {
    await this.countingRefusals(job, () =>
      this.ledger.requireQuota(job.userId),
    );
    let release: () => void;
    try {
      release = await this.slots.acquire(this.timing.slotWaitMs, signal);
    } catch (error) {
      if (!(error instanceof NoSlot)) throw error;
      if (error.reason === "aborted") {
        this.metrics.assistRequest(job.kind, "aborted");
        return abandoned;
      }
      this.metrics.assistRequest(job.kind, "busy");
      throw new AppError("DEPENDENCY_UNAVAILABLE", {
        fieldErrors: { assist: ["busy"] },
        retryable: true,
      });
    }
    let reservation: string;
    try {
      reservation = await this.countingRefusals(job, () =>
        this.ledger.reserve(job),
      );
    } catch (error) {
      release();
      throw error;
    }
    return new ModelAnswer(
      {
        model: this.model,
        ledger: this.ledger,
        metrics: this.metrics,
        retryDelayMs: this.timing.retryDelayMs,
        dailyLimit: this.settings.dailyLimit,
      },
      job,
      request,
      reservation,
      release,
      onComplete,
    );
  }

  /**
   * Counts a refusal by a daily limit, the reader's (`daily_limit`) or all
   * readers' (`paused`), in the metrics on its way out.
   */
  private async countingRefusals<T>(
    job: AssistJob,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const reason =
        error instanceof AppError ? error.fieldErrors.assist?.[0] : undefined;
      if (reason === "daily_limit" || reason === "paused")
        this.metrics.assistRequest(job.kind, reason);
      throw error;
    }
  }
}
