import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  type AtelierTask,
  type AtelierTaskResult,
  atelierTaskResultSchema,
  type Profile,
} from "@outegro/contracts/atelier";
import { processOnce } from "@outegro/db";
import { CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, asc, desc, eq, inArray, like, lt, sql } from "drizzle-orm";
import type { AtelierDatabase, AtelierTx } from "../common/database.js";
import { type PipelineConfig, pipelineConfig } from "../config/config.js";
import {
  applications,
  type JobContext,
  jobSteps,
  jobs,
  outbox,
  profiles,
  type StepError,
  vacancies,
} from "../db/schema.js";
import { enqueueTask, TaskRelay } from "../messaging/task-relay.js";
import { retryDelaysMs } from "../messaging/topology.js";
import {
  type FlowContext,
  type Job,
  type JobStep,
  type StartJobRequest,
  type StepDefinition,
  StepRefusal,
  type Workflow,
} from "./workflow.js";
import { workflowOf } from "./workflows.js";

export const ORCHESTRATOR_CONSUMER = "atelier.orchestrator";

const terminal = new Set(["done", "skipped"]);

const sha = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(value) ?? "")
    .digest("hex")
    .slice(0, 16);

/** A step error as stored and shown. */
const stepError = (
  code: string,
  message: string,
  retryable = false,
): StepError => ({
  code: code.slice(0, 80),
  message: message.slice(0, 2000),
  retryable,
});

/** What happened to a result: applied, stale (another task in flight) or a duplicate. */
export type ResultOutcome = "applied" | "stale" | "duplicate";

/**
 * Runs workflows: creates jobs, dispatches each step as a task (outbox, same
 * transaction as the step state), takes results (inbox: one per task id),
 * persists outputs and moves on. Tasks of one job run one after another,
 * jobs in parallel. Results are at-least-once: a duplicate or a result for a
 * task no longer in flight changes nothing.
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger("Orchestrator");

  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(pipelineConfig.KEY) private readonly config: PipelineConfig,
    @Optional() private readonly relay?: TaskRelay,
  ) {}

  /* ---------- starting ---------- */

  /** Starts a job in its own transaction; tasks go out after the commit. */
  async start(request: StartJobRequest): Promise<string> {
    const jobId = await this.database.db.transaction((tx) =>
      this.startIn(tx, request),
    );
    this.relay?.kick();
    return jobId;
  }

  /** Starts a job inside the caller's transaction; the caller kicks the relay. */
  startIn = async (
    tx: AtelierTx,
    request: StartJobRequest,
    seed?: { retryOf: string; reuse: Map<string, JobStep> },
  ): Promise<string> => {
    const workflow = workflowOf(request.kind);
    const now = this.clock.now();
    const id = randomUUID();
    const context: JobContext = {
      input: request.input ?? {},
      ...(seed ? { retryOf: seed.retryOf } : {}),
      ...(workflow.kind === "application.build"
        ? { cvVersionId: randomUUID() }
        : {}),
    };
    if (request.userId) {
      const [profile] = await tx
        .select({ version: profiles.version })
        .from(profiles)
        .where(eq(profiles.userId, request.userId));
      if (profile) context.profileVersion = profile.version;
    }
    await tx.insert(jobs).values({
      id,
      kind: workflow.kind,
      version: workflow.version,
      userId: request.userId ?? null,
      vacancyId: request.vacancyId ?? null,
      applicationId: request.applicationId ?? null,
      status: "queued",
      cursor: 0,
      context,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(jobSteps).values(
      workflow.steps.map((definition, seq) => {
        const reused = seed?.reuse.get(definition.step);
        return reused
          ? {
              jobId: id,
              step: definition.step,
              seq,
              status: reused.status,
              attempt: reused.attempt,
              output: reused.output,
              usage: reused.usage,
              note: reused.note ?? "reused from the previous run",
              startedAt: reused.startedAt,
              finishedAt: reused.finishedAt,
            }
          : {
              jobId: id,
              step: definition.step,
              seq,
              status: "queued" as const,
            };
      }),
    );
    await this.advance(tx, id);
    return id;
  };

  /* ---------- moving a job ---------- */

  private async load(
    tx: AtelierTx,
    jobId: string,
  ): Promise<FlowContext | null> {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .for("update");
    if (!job) return null;
    const steps = await tx
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.jobId, jobId))
      .orderBy(asc(jobSteps.seq));
    const outputs: Record<string, unknown> = {};
    for (const step of steps)
      if (step.status === "done") outputs[step.step] = step.output;
    let profile: Profile | null = null;
    if (job.userId) {
      const [row] = await tx
        .select({ data: profiles.data })
        .from(profiles)
        .where(eq(profiles.userId, job.userId));
      profile = row?.data ?? null;
    }
    const [vacancy] = job.vacancyId
      ? await tx.select().from(vacancies).where(eq(vacancies.id, job.vacancyId))
      : [];
    const [application] = job.applicationId
      ? await tx
          .select()
          .from(applications)
          .where(eq(applications.id, job.applicationId))
      : [];
    return {
      start: (inner, request) => this.startIn(inner, request),
      job,
      steps,
      outputs,
      profile,
      vacancy: vacancy ?? null,
      application: application ?? null,
      now: this.clock.now(),
    };
  }

  /**
   * Runs local steps and skips until the next remote step is dispatched or
   * the job ends. Call with the job's transaction.
   */
  async advance(tx: AtelierTx, jobId: string) {
    const ctx = await this.load(tx, jobId);
    if (!ctx) return;
    const workflow = workflowOf(ctx.job.kind, ctx.job.version);
    if (!["queued", "running"].includes(ctx.job.status)) return;
    for (const [seq, definition] of workflow.steps.entries()) {
      const step = ctx.steps.find((item) => item.seq === seq);
      if (!step) continue;
      if (terminal.has(step.status)) continue;
      if (step.status !== "queued") return; // in flight, paused or stopped
      try {
        const reason = definition.skip?.(ctx) ?? null;
        if (reason) {
          await this.updateStep(tx, ctx, step, {
            status: "skipped",
            note: reason,
            finishedAt: ctx.now,
          });
          continue;
        }
        if (definition.local) {
          await this.updateStep(tx, ctx, step, {
            status: "running",
            attempt: step.attempt + 1,
            startedAt: ctx.now,
          });
          const outcome = await definition.local(tx, ctx);
          if (outcome.status === "fail") {
            await this.failJob(tx, ctx, workflow, step, outcome.error);
            return;
          }
          if (outcome.status === "skipped") {
            await this.updateStep(tx, ctx, step, {
              status: "skipped",
              note: outcome.note,
              finishedAt: this.clock.now(),
            });
            continue;
          }
          await this.updateStep(tx, ctx, step, {
            status: "done",
            output: outcome.output,
            finishedAt: this.clock.now(),
          });
          ctx.outputs[step.step] = outcome.output;
          continue;
        }
        await this.dispatch(tx, ctx, definition, step, step.attempt + 1);
        await tx
          .update(jobs)
          .set({ status: "running", cursor: seq, updatedAt: ctx.now })
          .where(eq(jobs.id, jobId));
        return;
      } catch (error) {
        const refusal = error instanceof StepRefusal;
        if (!refusal)
          this.logger.error(
            { jobId, step: step.step, err: (error as Error).message },
            "Step could not start",
          );
        await this.failJob(
          tx,
          ctx,
          workflow,
          step,
          stepError(
            refusal ? error.code : "orchestrator_error",
            (error as Error).message,
          ),
        );
        return;
      }
    }
    await tx
      .update(jobs)
      .set({ status: "done", updatedAt: ctx.now, finishedAt: ctx.now })
      .where(eq(jobs.id, jobId));
    ctx.job.status = "done";
    await workflow.onDone?.(tx, ctx);
  }

  private async updateStep(
    tx: AtelierTx,
    ctx: FlowContext,
    step: JobStep,
    patch: Partial<typeof jobSteps.$inferInsert>,
  ) {
    await tx
      .update(jobSteps)
      .set(patch)
      .where(and(eq(jobSteps.jobId, ctx.job.id), eq(jobSteps.step, step.step)));
    Object.assign(step, patch);
  }

  /** Builds the task, stores it in the outbox and marks the step in flight. */
  private async dispatch(
    tx: AtelierTx,
    ctx: FlowContext,
    definition: StepDefinition,
    step: JobStep,
    attempt: number,
    options: { availableAt?: Date; note?: string; paused?: boolean } = {},
  ) {
    if (!definition.type || !definition.input)
      throw new Error(`step ${definition.step} is neither local nor remote`);
    const taskInput = await definition.input(ctx, tx);
    const startAt = options.availableAt ?? ctx.now;
    const deadline = new Date(
      startAt.getTime() + (definition.deadlineMs ?? 10 * 60_000),
    );
    const task: AtelierTask = {
      id: randomUUID(),
      jobId: ctx.job.id,
      type: definition.type,
      contract: definition.contract ?? 1,
      attempt: Math.min(attempt, 10),
      idempotencyKey: `${ctx.job.id}:${definition.step}:${sha(taskInput)}`,
      userId: ctx.job.userId,
      input: taskInput,
      deadline: deadline.toISOString(),
    };
    await enqueueTask(tx, task, options.availableAt);
    await this.updateStep(tx, ctx, step, {
      status: options.paused ? "paused" : "running",
      attempt,
      taskId: task.id,
      idempotencyKey: task.idempotencyKey,
      deadline,
      dueAt: options.availableAt ?? null,
      note: options.note ?? null,
      startedAt: step.startedAt ?? ctx.now,
    });
  }

  private async failJob(
    tx: AtelierTx,
    ctx: FlowContext,
    workflow: Workflow,
    step: JobStep,
    error: StepError,
  ) {
    await this.updateStep(tx, ctx, step, {
      status: "failed",
      error,
      finishedAt: ctx.now,
      dueAt: null,
    });
    const reason = `${step.step}: ${error.message}`;
    await tx
      .update(jobs)
      .set({
        status: "failed",
        context: { ...ctx.job.context, reason },
        updatedAt: ctx.now,
        finishedAt: ctx.now,
      })
      .where(eq(jobs.id, ctx.job.id));
    ctx.job.status = "failed";
    await workflow.onFailed?.(tx, ctx, reason);
  }

  /* ---------- results ---------- */

  /** Applies one task result exactly once; returns what it did. */
  async handleResult(raw: unknown): Promise<ResultOutcome> {
    const result = atelierTaskResultSchema.parse(raw);
    let outcome: ResultOutcome = "duplicate";
    await processOnce(
      this.database.db,
      {
        consumer: ORCHESTRATOR_CONSUMER,
        eventId: result.taskId,
        type: `atelier.result.${result.type}`,
      },
      async (tx) => {
        outcome = await this.applyResult(tx as AtelierTx, result);
      },
    );
    this.relay?.kick();
    return outcome;
  }

  private async applyResult(
    tx: AtelierTx,
    result: AtelierTaskResult,
  ): Promise<ResultOutcome> {
    const ctx = await this.load(tx, result.jobId);
    if (!ctx) return "stale";
    const step = ctx.steps.find((item) => item.taskId === result.taskId);
    if (!step || !["running", "paused"].includes(step.status)) return "stale";
    if (!["running", "queued"].includes(ctx.job.status)) return "stale";
    const workflow = workflowOf(ctx.job.kind, ctx.job.version);
    const definition = workflow.steps.find((item) => item.step === step.step);
    if (!definition) return "stale";
    const now = ctx.now;
    const usage = result.usage ?? null;

    switch (result.status) {
      case "ok": {
        try {
          await definition.apply?.(tx, ctx, result.output);
        } catch (error) {
          this.logger.warn(
            {
              jobId: ctx.job.id,
              step: step.step,
              err: (error as Error).message,
            },
            "Step output refused",
          );
          await this.failJob(
            tx,
            ctx,
            workflow,
            step,
            stepError("invalid_output", (error as Error).message),
          );
          return "applied";
        }
        await this.updateStep(tx, ctx, step, {
          status: "done",
          output: result.output ?? null,
          usage,
          error: null,
          note: null,
          dueAt: null,
          finishedAt: now,
        });
        await this.advance(tx, ctx.job.id);
        return "applied";
      }
      case "retry": {
        const error =
          result.error ?? stepError("retry", "the worker asked to retry", true);
        if (error.code === "provider_quota") {
          const resetsAt = (result.output as { resetsAt?: string } | undefined)
            ?.resetsAt;
          const parsed = resetsAt ? new Date(resetsAt) : null;
          const due =
            parsed && !Number.isNaN(parsed.getTime()) && parsed > now
              ? parsed
              : new Date(now.getTime() + this.config.quotaPauseSeconds * 1000);
          // The provider's limit, not the step's fault: the attempt is not counted.
          await this.dispatch(tx, ctx, definition, step, step.attempt, {
            availableAt: due,
            paused: true,
            note: `quota: paused until ${due.toISOString()}`,
          });
          await this.updateStep(tx, ctx, step, { usage, error });
          return "applied";
        }
        if (step.attempt >= this.config.maxAttempts) {
          await this.failJob(tx, ctx, workflow, step, {
            ...error,
            message: `after ${step.attempt} attempts: ${error.message}`,
          });
          return "applied";
        }
        const delay =
          retryDelaysMs[Math.min(step.attempt - 1, retryDelaysMs.length - 1)] ??
          15_000;
        const due = new Date(now.getTime() + delay);
        await this.dispatch(tx, ctx, definition, step, step.attempt + 1, {
          availableAt: due,
          paused: true,
          note: `retry ${step.attempt + 1} at ${due.toISOString()}: ${error.code}`,
        });
        await this.updateStep(tx, ctx, step, { usage, error });
        return "applied";
      }
      case "needs_human": {
        const reason =
          result.error?.message ??
          (result.output as { reason?: string } | undefined)?.reason ??
          "a person has to act";
        await this.updateStep(tx, ctx, step, {
          status: "waiting_human",
          output: result.output ?? null,
          usage,
          note: reason.slice(0, 2000),
          finishedAt: now,
        });
        await tx
          .update(jobs)
          .set({
            status: "waiting_human",
            context: { ...ctx.job.context, reason: `${step.step}: ${reason}` },
            updatedAt: now,
          })
          .where(eq(jobs.id, ctx.job.id));
        ctx.job.status = "waiting_human";
        await workflow.onNeedsHuman?.(tx, ctx, reason);
        return "applied";
      }
      case "fail": {
        await this.updateStep(tx, ctx, step, { usage });
        await this.failJob(
          tx,
          ctx,
          workflow,
          step,
          result.error ?? stepError("failed", "the worker failed the task"),
        );
        return "applied";
      }
    }
  }

  /* ---------- timers ---------- */

  /**
   * Steps past their deadline (a worker died with the task, or its message
   * sits in the DLQ) are retried like a `retry` result; paused steps whose
   * time has come show as running again.
   */
  async sweep(): Promise<{ expired: number }> {
    const now = this.clock.now();
    await this.database.db
      .update(jobSteps)
      .set({ status: "running", dueAt: null })
      .where(and(eq(jobSteps.status, "paused"), lt(jobSteps.dueAt, now)));
    const expired = await this.database.db
      .select({
        jobId: jobSteps.jobId,
        taskId: jobSteps.taskId,
        step: jobSteps.step,
      })
      .from(jobSteps)
      .where(and(eq(jobSteps.status, "running"), lt(jobSteps.deadline, now)))
      .limit(100);
    for (const item of expired) {
      if (!item.taskId) continue;
      const [job] = await this.database.db
        .select({ kind: jobs.kind, version: jobs.version })
        .from(jobs)
        .where(eq(jobs.id, item.jobId));
      const type = job
        ? workflowOf(job.kind, job.version).steps.find(
            (s) => s.step === item.step,
          )?.type
        : null;
      if (!type) continue;
      await this.handleResult({
        taskId: item.taskId,
        jobId: item.jobId,
        type,
        status: "retry",
        error: {
          code: "deadline",
          message: "no result before the deadline",
          retryable: true,
        },
      });
    }
    return { expired: expired.length };
  }

  /** Quota-paused steps go out now (the provider's pause was lifted by hand). */
  async releaseQuotaPauses(): Promise<number> {
    const now = this.clock.now();
    const released = await this.database.db.transaction(async (tx) => {
      const paused = await tx
        .update(jobSteps)
        .set({ status: "running", dueAt: null, note: "quota pause lifted" })
        .where(
          and(eq(jobSteps.status, "paused"), like(jobSteps.note, "quota:%")),
        )
        .returning({ taskId: jobSteps.taskId });
      const ids = paused.flatMap((row) => (row.taskId ? [row.taskId] : []));
      if (ids.length)
        await tx
          .update(outbox)
          .set({ availableAt: now })
          .where(
            and(inArray(outbox.eventId, ids), eq(outbox.status, "pending")),
          );
      return ids.length;
    });
    this.relay?.kick();
    return released;
  }

  /* ---------- retry from a step ---------- */

  /**
   * Runs the tail of an application's last job again as a new job: steps
   * before `fromStep` keep their outputs, the rest run anew. Without a step:
   * from the step that failed or waits; a finished job runs from the start.
   */
  async retry(applicationId: string, fromStep?: string, kind?: string) {
    const jobId = await this.database.db.transaction(async (tx) => {
      const candidates = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.applicationId, applicationId),
            inArray(
              jobs.kind,
              kind ? [kind] : ["application.build", "application.send"],
            ),
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(10);
      const previous =
        (fromStep
          ? candidates.find((job) =>
              workflowOf(job.kind, job.version).steps.some(
                (s) => s.step === fromStep,
              ),
            )
          : candidates[0]) ?? null;
      if (!previous) return null;
      await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, previous.id))
        .for("update");
      const steps = await tx
        .select()
        .from(jobSteps)
        .where(eq(jobSteps.jobId, previous.id))
        .orderBy(asc(jobSteps.seq));
      const workflow = workflowOf(previous.kind);
      const order = workflow.steps.map((s) => s.step);
      const from =
        fromStep ??
        steps.find((s) => !terminal.has(s.status))?.step ??
        order[0];
      const cut = from ? order.indexOf(from) : 0;
      if (cut < 0) return null;
      const reuse = new Map<string, JobStep>();
      // Outputs carry over only to the same workflow version.
      if (previous.version === workflow.version)
        for (const step of steps)
          if (order.indexOf(step.step) < cut && terminal.has(step.status))
            reuse.set(step.step, step);
      if (!["done", "failed"].includes(previous.status)) {
        await tx
          .update(jobs)
          .set({
            status: "failed",
            context: { ...previous.context, reason: "superseded by a retry" },
            updatedAt: this.clock.now(),
            finishedAt: this.clock.now(),
          })
          .where(eq(jobs.id, previous.id));
        await tx
          .update(jobSteps)
          .set({ status: "failed", note: "superseded by a retry", dueAt: null })
          .where(
            and(
              eq(jobSteps.jobId, previous.id),
              inArray(jobSteps.status, [
                "running",
                "paused",
                "queued",
                "waiting_human",
              ]),
            ),
          );
      }
      return this.startIn(
        tx,
        {
          kind: previous.kind,
          userId: previous.userId,
          vacancyId: previous.vacancyId,
          applicationId: previous.applicationId,
          input: previous.context.input ?? {},
        },
        { retryOf: previous.id, reuse },
      );
    });
    this.relay?.kick();
    return jobId;
  }

  /** Jobs still moving (pipeline screen), newest first. */
  async activeSteps() {
    return this.database.db
      .select({ step: jobSteps.step, count: sql<number>`count(*)::int` })
      .from(jobSteps)
      .where(eq(jobSteps.status, "running"))
      .groupBy(jobSteps.step);
  }
}

export type { Job };
