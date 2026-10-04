import { Inject, Injectable } from "@nestjs/common";
import { safeMode } from "@outegro/nest-common";
import { type AssistConfig, assistConfig } from "../config/config.js";

/** Injection token of the assistant's timings (tests make them short). */
export const ASSIST_TIMING = Symbol("ASSIST_TIMING");

export type AssistTiming = {
  /** A `: keep-alive` comment this often until the first words. */
  readonly keepAliveMs: number;
  /** How long a request waits for a free model slot before 503. */
  readonly slotWaitMs: number;
  /** Pause before the one retry of a call that failed before any text. */
  readonly retryDelayMs: number;
};

export const defaultAssistTiming: AssistTiming = {
  keepAliveMs: 15_000,
  slotWaitMs: 20_000,
  retryDelayMs: 1_000,
};

/**
 * Whether the assistant answers and within what limits. It is on only when
 * the owner turned it on, a provider key is set and the service is not in
 * SAFE_MODE (a call to the model is a side effect outside this service, held
 * like the others after a restore). Read on every request.
 */
@Injectable()
export class AssistSettings {
  constructor(
    @Inject(assistConfig.KEY) private readonly config: AssistConfig,
  ) {}

  get enabled(): boolean {
    return this.config.enabled && Boolean(this.config.apiKey) && !safeMode();
  }

  get dailyLimit(): number {
    return this.config.dailyLimit;
  }

  /** Requests to the model per UTC day across all readers; 0 is no cap. */
  get globalDailyLimit(): number {
    return this.config.globalDailyLimit;
  }

  get maxTokens(): number {
    return this.config.maxTokens;
  }
}
