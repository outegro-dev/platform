import type { AtelierTaskType, Profile } from "@outegro/contracts/atelier";
import type { Vacancy } from "../catalog/catalog.js";
import type { AtelierTx } from "../common/database.js";
import type { applications, jobSteps, jobs, StepError } from "../db/schema.js";

export type Job = typeof jobs.$inferSelect;
export type JobStep = typeof jobSteps.$inferSelect;
export type Application = typeof applications.$inferSelect;

export type StartJobRequest = {
  kind: string;
  userId?: string | null;
  vacancyId?: string | null;
  applicationId?: string | null;
  input?: Record<string, unknown>;
};

/** Starts another job in the same transaction (ingest → build). */
export type JobStarter = (
  tx: AtelierTx,
  request: StartJobRequest,
) => Promise<string>;

/** What a step's input and effects are computed from, loaded for every move. */
export type FlowContext = {
  start: JobStarter;
  job: Job;
  steps: JobStep[];
  /** Outputs of the done steps of this job, by step name. */
  outputs: Record<string, unknown>;
  profile: Profile | null;
  vacancy: Vacancy | null;
  application: Application | null;
  now: Date;
};

export type LocalOutcome =
  | { status: "ok"; output: unknown }
  | { status: "skipped"; note: string }
  | { status: "fail"; error: StepError };

export type StepDefinition = {
  /** Unique within the workflow; shown on the pipeline screen. */
  step: string;
  /** The task type (queue) of a remote step; for a local one its kind. */
  type: AtelierTaskType | null;
  /** Input contract version the worker handler expects. */
  contract?: number;
  /** How long one attempt may take before it is retried. */
  deadlineMs?: number;
  /** Reason to skip this step, or null to run it. */
  skip?: (ctx: FlowContext) => string | null;
  /** Remote step: the task input; workers get everything from it. */
  input?: (ctx: FlowContext, tx: AtelierTx) => Promise<unknown> | unknown;
  /** Local step: runs in the orchestrator's transaction. */
  local?: (tx: AtelierTx, ctx: FlowContext) => Promise<LocalOutcome>;
  /** Persists what the output means (vacancy, CV version, materials…). */
  apply?: (tx: AtelierTx, ctx: FlowContext, output: unknown) => Promise<void>;
};

export type WorkflowHooks = {
  onDone?: (tx: AtelierTx, ctx: FlowContext) => Promise<void>;
  onFailed?: (tx: AtelierTx, ctx: FlowContext, reason: string) => Promise<void>;
  onNeedsHuman?: (
    tx: AtelierTx,
    ctx: FlowContext,
    reason: string,
  ) => Promise<void>;
};

/**
 * A pipeline as a versioned list of steps. A running job finishes on the
 * version it started with; a change of steps is a new version.
 */
export type Workflow = WorkflowHooks & {
  kind: string;
  version: number;
  steps: StepDefinition[];
};

/** Thrown inside a step definition: the step fails with this code. */
export class StepRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
