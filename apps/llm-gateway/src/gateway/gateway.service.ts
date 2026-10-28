import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  LlmGenerateRequest,
  LlmGenerateResponse,
  LlmProfile,
  LlmProviderStatus,
} from "@outegro/contracts/atelier";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { type GatewayConfig, gatewayConfig } from "../config/config.js";
import {
  CallAborted,
  classifyFailure,
  LlmFailure,
} from "../domain/failures.js";
import {
  assertSupportedSchema,
  SchemaError,
  validateJson,
} from "../domain/json-schema.js";
import { pauseSeconds } from "../domain/pause.js";
import {
  type Profile,
  type ProfilesFile,
  type ProviderId,
  profileView,
} from "../domain/profiles.js";
import { Semaphore } from "../domain/semaphore.js";
import {
  type GenerateCall,
  LLM_PROVIDERS,
  type LlmProvider,
  type ProviderResult,
} from "../providers/provider.js";
import { GatewayMetrics } from "./gateway.metrics.js";

/** The loaded profiles file. */
export const PROFILES = Symbol("PROFILES");

type Pause = { until: Date; reason: string };

/** A correction round needs at least this much of the time budget left. */
const MIN_CORRECTION_MS = 5000;

const addTokens = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/**
 * One API over the model providers: resolves the profile, refuses a paused
 * or unavailable provider at once, queues for one of the provider's slots,
 * runs the call, checks the answer against the request schema (one
 * correction round) and pauses the provider after a usage limit. Logs and
 * metrics carry purpose, profile, time, tokens and the error code; prompts
 * and answers are never logged.
 */
@Injectable()
export class GatewayService {
  private readonly logger = new Logger("LlmGateway");
  private readonly providers = new Map<ProviderId, LlmProvider>();
  private readonly slots = new Map<ProviderId, Semaphore>();
  private readonly pauses = new Map<ProviderId, Pause>();

  constructor(
    @Inject(PROFILES) private readonly profiles: ProfilesFile,
    @Inject(LLM_PROVIDERS) providers: LlmProvider[],
    @Inject(gatewayConfig.KEY) private readonly config: GatewayConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly metrics: GatewayMetrics,
  ) {
    for (const provider of providers) {
      const settings = profiles.providers[provider.id];
      if (!settings) continue;
      this.providers.set(provider.id, provider);
      this.slots.set(provider.id, new Semaphore(settings.concurrency));
    }
    metrics.watch(() =>
      [...this.slots].map(([id, slots]) => ({
        id,
        inFlight: slots.inFlight,
        waiting: slots.waiting,
        paused: this.pauseOf(id) !== null,
      })),
    );
  }

  profileList(): LlmProfile[] {
    return this.profiles.profiles.map(profileView);
  }

  providerList(): LlmProviderStatus[] {
    return [...this.providers.keys()].map((id) => this.statusOf(id));
  }

  /** Lifts a pause by hand (a limit reset earlier than announced). */
  resume(id: string): LlmProviderStatus | null {
    if (!this.providers.has(id as ProviderId)) return null;
    if (this.pauses.delete(id as ProviderId))
      this.logger.log({ provider: id }, "Provider pause lifted by hand");
    return this.statusOf(id as ProviderId);
  }

  async generate(
    request: LlmGenerateRequest,
    signal: AbortSignal,
  ): Promise<LlmGenerateResponse> {
    const started = performance.now();
    const profile = this.profiles.profiles.find(
      (item) => item.id === request.profile,
    );
    const providerId = profile?.provider ?? "unknown";
    const log = {
      // The caller's id of the call; `requestId` is the HTTP request's own.
      callId: request.requestId,
      purpose: request.purpose,
      profile: request.profile,
      provider: providerId,
    };
    let queueMs = 0;
    try {
      if (!profile)
        throw new LlmFailure(
          "bad_request",
          `Unknown profile ${request.profile}`,
        );
      if (
        request.account !== undefined &&
        request.account !== this.config.account
      )
        throw new LlmFailure(
          "bad_request",
          `Unknown account ${request.account}`,
        );
      try {
        assertSupportedSchema(request.schema);
      } catch (error) {
        if (error instanceof SchemaError)
          throw new LlmFailure(
            "bad_request",
            `Unusable schema: ${error.message}`,
          );
        throw error;
      }
      const provider = this.providers.get(profile.provider);
      const slots = this.slots.get(profile.provider);
      const settings = this.profiles.providers[profile.provider];
      if (!provider || !slots || !settings)
        throw new LlmFailure(
          "provider_unavailable",
          `No provider ${profile.provider}`,
          {
            retryable: false,
          },
        );
      const unavailable = provider.availability();
      if (unavailable)
        throw new LlmFailure("provider_unavailable", unavailable, {
          retryable: false,
        });
      this.refuseIfPaused(profile.provider);

      const queued = performance.now();
      const release = await slots.acquire({
        maxWaitMs: this.config.queueTimeoutMs,
        signal,
        onTimeout: () =>
          new LlmFailure(
            "provider_unavailable",
            `Timed out waiting ${Math.round(this.config.queueTimeoutMs / 1000)} s for a ${profile.provider} slot`,
          ),
      });
      queueMs = Math.round(performance.now() - queued);
      this.metrics.waited(profile.provider, queueMs / 1000);
      try {
        this.refuseIfPaused(profile.provider);
        const result = await this.run(provider, {
          profile,
          settings,
          system: request.system,
          input: request.input,
          schema: request.schema,
          timeoutMs: request.timeoutMs ?? settings.timeoutMs,
          signal,
        });
        const ms = Math.round(performance.now() - started);
        this.metrics.finished(profile.provider, profile.id, "ok", ms / 1000);
        this.logger.log(
          {
            ...log,
            model: result.model,
            ms,
            queueMs,
            tokensIn: result.inputTokens,
            tokensOut: result.outputTokens,
            corrected: result.corrected,
          },
          "Generation succeeded",
        );
        return {
          output: result.output,
          provider: profile.provider,
          model: result.model,
          usage: { input: result.inputTokens, output: result.outputTokens },
          ms,
        };
      } finally {
        release();
      }
    } catch (error) {
      const ms = Math.round(performance.now() - started);
      // Label values only from the profiles file, never from the request.
      const profileLabel = profile ? profile.id : "unknown";
      if (error instanceof CallAborted || signal.aborted) {
        this.metrics.finished(providerId, profileLabel, "aborted", ms / 1000);
        this.logger.log(
          { ...log, ms, queueMs, error: "aborted" },
          "Generation aborted",
        );
        throw error instanceof CallAborted ? error : new CallAborted();
      }
      const failure = classifyFailure(error, providerId);
      if (
        failure.code === "provider_quota" &&
        profile &&
        failure.resetsAt === null
      )
        failure.resetsAt = this.pause(profile, failure.message);
      this.metrics.finished(providerId, profileLabel, failure.code, ms / 1000);
      const line = {
        ...log,
        ms,
        queueMs,
        error: failure.code,
        retryable: failure.retryable,
        resetsAt: failure.resetsAt?.toISOString() ?? null,
        reason: failure.message.slice(0, 500),
      };
      if (failure.code === "bad_request" || failure.code === "provider_quota")
        this.logger.log(line, "Generation refused");
      else this.logger.warn(line, "Generation failed");
      throw failure;
    }
  }

  /** The call and, if its answer fails the schema, one correction round. */
  private async run(
    provider: LlmProvider,
    call: GenerateCall,
  ): Promise<ProviderResult & { corrected: boolean }> {
    const deadline = Date.now() + call.timeoutMs;
    const first = await provider.generate(call);
    this.metrics.spent(provider.id, first.inputTokens, first.outputTokens);
    const errors = this.check(first.output, call);
    if (errors.length === 0) return { ...first, corrected: false };

    const remaining = deadline - Date.now();
    if (remaining < MIN_CORRECTION_MS) {
      this.metrics.corrected(provider.id, false);
      throw this.invalid(errors);
    }
    const second = await provider.generate({
      ...call,
      timeoutMs: remaining,
      correction: {
        output: first.output,
        errors,
        transcript: first.transcript,
      },
    });
    this.metrics.spent(provider.id, second.inputTokens, second.outputTokens);
    const left = this.check(second.output, call);
    this.metrics.corrected(provider.id, left.length === 0);
    if (left.length > 0) throw this.invalid(left);
    return {
      ...second,
      inputTokens: addTokens(first.inputTokens, second.inputTokens),
      outputTokens: addTokens(first.outputTokens, second.outputTokens),
      corrected: true,
    };
  }

  private check(output: unknown, call: GenerateCall) {
    try {
      return validateJson(output, call.schema);
    } catch (error) {
      if (error instanceof SchemaError)
        throw new LlmFailure(
          "bad_request",
          `Unusable schema: ${error.message}`,
        );
      throw error;
    }
  }

  private invalid(errors: string[]) {
    return new LlmFailure(
      "invalid_output",
      `The answer does not match the schema after a correction: ${errors.join("; ")}`,
    );
  }

  private pauseOf(id: ProviderId): Pause | null {
    const pause = this.pauses.get(id);
    if (!pause) return null;
    if (pause.until <= this.clock.now()) {
      this.pauses.delete(id);
      return null;
    }
    return pause;
  }

  private refuseIfPaused(id: ProviderId) {
    const pause = this.pauseOf(id);
    if (pause)
      throw new LlmFailure(
        "provider_quota",
        `${id} is paused: ${pause.reason}`,
        {
          resetsAt: pause.until,
        },
      );
  }

  /** Pauses the provider until the reset its message names; queued calls are refused now. */
  private pause(profile: Profile, message: string): Date {
    const now = this.clock.now();
    const seconds = pauseSeconds(message, now, this.config.quotaPauseSeconds);
    const until = new Date(now.getTime() + seconds * 1000);
    const current = this.pauses.get(profile.provider);
    const pause =
      current && current.until > until
        ? current
        : { until, reason: message.slice(0, 500) };
    this.pauses.set(profile.provider, pause);
    this.logger.warn(
      { provider: profile.provider, until: pause.until.toISOString(), seconds },
      "Provider paused after a usage limit",
    );
    this.slots.get(profile.provider)?.rejectWaiting(
      () =>
        new LlmFailure(
          "provider_quota",
          `${profile.provider} is paused: ${pause.reason}`,
          {
            resetsAt: pause.until,
          },
        ),
    );
    return pause.until;
  }

  private statusOf(id: ProviderId): LlmProviderStatus {
    const provider = this.providers.get(id);
    const slots = this.slots.get(id);
    const unavailable = provider ? provider.availability() : "Not configured";
    const pause = this.pauseOf(id);
    return {
      id,
      available: unavailable === null && pause === null,
      reason:
        unavailable ??
        (pause ? `Paused after a usage limit: ${pause.reason}` : null),
      pausedUntil: pause?.until.toISOString() ?? null,
      concurrency: slots?.limit ?? 1,
      inFlight: slots?.inFlight ?? 0,
    };
  }
}
