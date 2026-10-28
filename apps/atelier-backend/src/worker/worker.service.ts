import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  type AtelierTask,
  type AtelierTaskResult,
  type AtelierTaskType,
  atelierTaskSchema,
} from "@outegro/contracts/atelier";
import {
  CLOCK,
  type Clock,
  type Counter,
  type Histogram,
  heldBySafeMode,
  Metrics,
  VALKEY,
} from "@outegro/nest-common";
import type { Redis } from "ioredis";
import { ZodError } from "zod";
import { llmPort } from "../clients/llm.client.js";
import { browserPort, texPort } from "../clients/tex.client.js";
import {
  type ServicesConfig,
  servicesConfig,
  type WorkerConfig,
  workerConfig,
} from "../config/config.js";
import { PoisonMessageError, TaskBus } from "../messaging/task-bus.js";
import {
  PortError,
  type StepContext,
  type StepHandler,
  type StepOutcome,
  type UsageMeter,
} from "../steps/step-handler.js";
import type { Storage } from "../storage/storage.js";

export const STEP_HANDLERS = Symbol("STEP_HANDLERS");
export type StepHandlers = Map<AtelierTaskType, StepHandler<never>>;

/** Builds the ports of one task; tests replace it with fakes. */
export const STEP_PORTS = Symbol("STEP_PORTS");
export type StepPortsFactory = (
  task: AtelierTask,
  usage: UsageMeter,
) => Omit<StepContext, "log" | "now">;

/** Concurrent tasks per queue: TeX and the browser are heavy, model calls slow. */
const prefetchOf = (type: AtelierTaskType, concurrency: number) =>
  type === "fit" || type === "send" ? 1 : Math.max(1, concurrency);

const CACHE_TTL_SECONDS = 7 * 24 * 3600;

/**
 * Consumes atelier.task.<type> queues and runs the step handlers. A result
 * is cached in Valkey under the task's idempotency key: a redelivered task
 * (worker restart, broker redelivery) republishes the cached result instead
 * of calling the model again. Handlers never touch the database.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Worker");
  private readonly tasks: Counter<"type" | "status">;
  private readonly duration: Histogram<"type">;

  constructor(
    private readonly bus: TaskBus,
    @Inject(STEP_HANDLERS) private readonly handlers: StepHandlers,
    @Inject(STEP_PORTS) private readonly ports: StepPortsFactory,
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(workerConfig.KEY) private readonly config: WorkerConfig,
    metrics: Metrics,
  ) {
    this.tasks = metrics.counter({
      name: "atelier_tasks_total",
      help: "Tasks run by a worker, by type and outcome (ok, retry, fail, needs_human, cached).",
      labelNames: ["type", "status"],
    });
    this.duration = metrics.histogram({
      name: "atelier_task_duration_seconds",
      help: "Time a worker spent on one task, by type.",
      labelNames: ["type"],
      buckets: [0.05, 0.25, 1, 5, 15, 30, 60, 120, 300, 600, 1200],
    });
  }

  async onApplicationBootstrap() {
    if (heldBySafeMode("atelier-worker")) return;
    const wanted = this.config.tasks?.length
      ? new Set(this.config.tasks)
      : null;
    for (const [type] of this.handlers) {
      if (wanted && !wanted.has(type)) continue;
      await this.bus.consumeTasks(type, (raw) => this.run(raw), {
        prefetch: prefetchOf(type, this.config.concurrency),
        onExhausted: (raw, error) => this.giveUp(raw, error),
      });
    }
    this.logger.log({ tasks: [...this.handlers.keys()] }, "Worker consuming");
  }

  /** Runs one task message and publishes its result. */
  async run(raw: unknown) {
    const parsed = atelierTaskSchema.safeParse(raw);
    if (!parsed.success) throw new PoisonMessageError("invalid task message");
    const task = parsed.data;
    const key = `task:${task.idempotencyKey}`;
    const cached = await this.valkey.get(key);
    if (cached) {
      const result = JSON.parse(cached) as AtelierTaskResult;
      await this.bus.publishResult({
        ...result,
        taskId: task.id,
        jobId: task.jobId,
      });
      this.tasks.inc({ type: task.type, status: "cached" });
      return;
    }
    // A copy of this task is being worked on (a redelivery while the first
    // delivery still runs): drop it, the first one publishes the result. If
    // that worker died, the lock ends with the task's deadline and the
    // orchestrator dispatches the step again.
    const lock = `lock:${task.idempotencyKey}`;
    const lockMs = Math.max(60_000, Date.parse(task.deadline) - Date.now());
    const locked = await this.valkey.set(lock, task.id, "PX", lockMs, "NX");
    if (!locked) {
      this.logger.warn(
        { taskId: task.id, type: task.type },
        "Duplicate task dropped",
      );
      this.tasks.inc({ type: task.type, status: "duplicate" });
      return;
    }
    try {
      const result = await this.execute(task);
      if (result.status !== "retry")
        await this.valkey.set(
          key,
          JSON.stringify(result),
          "EX",
          CACHE_TTL_SECONDS,
        );
      await this.bus.publishResult(result);
    } finally {
      await this.valkey.del(lock).catch(() => undefined);
    }
  }

  /** The handler's outcome as a result; never throws for the task's own failures. */
  async execute(task: AtelierTask): Promise<AtelierTaskResult> {
    const started = Date.now();
    const usage: UsageMeter = { llmCalls: 0, tokensIn: 0, tokensOut: 0, ms: 0 };
    const outcome = await this.outcomeOf(task, usage);
    usage.ms = Date.now() - started;
    this.tasks.inc({ type: task.type, status: outcome.status });
    this.duration.observe({ type: task.type }, usage.ms / 1000);
    const base = { taskId: task.id, jobId: task.jobId, type: task.type, usage };
    switch (outcome.status) {
      case "ok":
        return { ...base, status: "ok", output: outcome.output };
      case "retry":
        return {
          ...base,
          status: "retry",
          error: outcome.error,
          ...(outcome.resetsAt
            ? { output: { resetsAt: outcome.resetsAt } }
            : {}),
        };
      case "fail":
        return {
          ...base,
          status: "fail",
          error: outcome.error,
          ...(outcome.output === undefined ? {} : { output: outcome.output }),
        };
      case "needs_human":
        return {
          ...base,
          status: "needs_human",
          output: {
            reason: outcome.reason,
            ...(asObject(outcome.output) ?? {}),
          },
          error: {
            code: "needs_human",
            message: outcome.reason,
            retryable: false,
          },
        };
    }
  }

  private async outcomeOf(
    task: AtelierTask,
    usage: UsageMeter,
  ): Promise<StepOutcome> {
    const handler = this.handlers.get(task.type);
    if (!handler) return failure("no_handler", `no handler for ${task.type}`);
    if (handler.contract !== task.contract)
      return failure(
        "contract_mismatch",
        `${task.type} handles contract ${handler.contract}, got ${task.contract}`,
      );
    const input = handler.input.safeParse(task.input);
    if (!input.success)
      return failure("invalid_input", input.error.message.slice(0, 2000));
    const ctx: StepContext = {
      ...this.ports(task, usage),
      log: {
        info: (data, message) =>
          this.logger.log(
            { ...data, taskId: task.id, type: task.type },
            message,
          ),
        warn: (data, message) =>
          this.logger.warn(
            { ...data, taskId: task.id, type: task.type },
            message,
          ),
      },
      now: () => this.clock.now(),
    };
    try {
      return await handler.handle({ ...task, input: input.data as never }, ctx);
    } catch (error) {
      if (error instanceof PortError) {
        if (error.code === "provider_quota")
          return {
            status: "retry",
            error: {
              code: error.code,
              message: error.message,
              retryable: true,
            },
            resetsAt: error.resetsAt,
          };
        return error.retryable
          ? {
              status: "retry",
              error: {
                code: error.code,
                message: error.message,
                retryable: true,
              },
            }
          : failure(error.code, error.message);
      }
      if (error instanceof ZodError)
        return failure("invalid_data", error.message.slice(0, 2000));
      this.logger.warn(
        { taskId: task.id, type: task.type, err: (error as Error).message },
        "Step handler threw",
      );
      // Unknown errors may be transient (storage, network): counted retries.
      return {
        status: "retry",
        error: {
          code: "handler_error",
          message: String((error as Error)?.message ?? error).slice(0, 2000),
          retryable: true,
        },
      };
    }
  }

  /** The last message-level retry failed: tell the orchestrator, then DLQ. */
  private async giveUp(raw: unknown, error: Error) {
    const parsed = atelierTaskSchema.safeParse(raw);
    if (!parsed.success) return;
    await this.bus.publishResult({
      taskId: parsed.data.id,
      jobId: parsed.data.jobId,
      type: parsed.data.type,
      status: "fail",
      error: {
        code: "worker_exhausted",
        message: `the worker gave up: ${error.message}`.slice(0, 2000),
        retryable: false,
      },
    });
  }
}

const failure = (code: string, message: string): StepOutcome => ({
  status: "fail",
  error: { code, message: message.slice(0, 2000), retryable: false },
});

const asObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The real ports: llm-gateway, atelier-tex, atelier-browser, storage. */
export function defaultPorts(
  services: ServicesConfig,
  storage: Storage,
): StepPortsFactory {
  const tex = texPort(services.tex);
  const browser = browserPort(services.browser);
  return (task, usage) => ({
    llm: llmPort(services.llm, task.type, task.idempotencyKey, usage),
    tex,
    browser,
    storage,
  });
}

export { servicesConfig };
