import type {
  AtelierTask,
  AtelierTaskType,
  BrowserApplyRequest,
  BrowserApplyResponse,
  TaskUsage,
  TexRenderRequest,
  TexRenderResponse,
} from "@outegro/contracts/atelier";
import type { z } from "zod";

/** A prompt as @outegro/atelier-engine builds it for llm-gateway. */
export type LlmPrompt<T> = {
  purpose: string;
  system: string;
  input: string;
  /** JSON Schema of the answer (or a Zod schema, converted on the way). */
  schema: unknown;
  parse(output: unknown): T;
};

export type LlmPort = {
  /** One model call for this step; the answer parsed by the prompt. */
  generate<T>(prompt: LlmPrompt<T>, options?: { key?: string }): Promise<T>;
};

export type TexPort = {
  render(request: TexRenderRequest): Promise<TexRenderResponse>;
};

export type BrowserPort = {
  apply(request: BrowserApplyRequest): Promise<BrowserApplyResponse>;
};

export type StoredFile = {
  key: string;
  contentType: string;
  size: number;
  sha256: string;
};

export type StoragePort = {
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  head(key: string): Promise<StoredFile | null>;
};

export type StepLog = {
  info(data: Record<string, unknown>, message: string): void;
  warn(data: Record<string, unknown>, message: string): void;
};

/** What a handler may use; it never touches the database. */
export type StepContext = {
  llm: LlmPort;
  tex: TexPort;
  browser: BrowserPort;
  storage: StoragePort;
  log: StepLog;
  now: () => Date;
};

export type StepError = { code: string; message: string; retryable: boolean };

/** How one task ended; the worker turns it into an AtelierTaskResult. */
export type StepOutcome =
  | { status: "ok"; output: unknown }
  /** Try again later; `resetsAt` (a provider quota) pauses until then. */
  | { status: "retry"; error: StepError; resetsAt?: string | null }
  | { status: "fail"; error: StepError; output?: unknown }
  /** A person has to act (captcha, login, a page that needs a browser). */
  | { status: "needs_human"; reason: string; output?: unknown };

export type TaskOf<I> = Omit<AtelierTask, "input"> & { input: I };

/** One task type: pure code over its input plus the ports in `ctx`. */
export interface StepHandler<I = unknown> {
  readonly type: AtelierTaskType;
  /** Version of the input shape; a task with another contract is refused. */
  readonly contract: number;
  readonly input: z.ZodType<I>;
  handle(task: TaskOf<I>, ctx: StepContext): Promise<StepOutcome>;
}

export const ok = (output: unknown): StepOutcome => ({ status: "ok", output });
export const fail = (
  code: string,
  message: string,
  output?: unknown,
): StepOutcome => ({
  status: "fail",
  error: { code, message: message.slice(0, 2000), retryable: false },
  ...(output === undefined ? {} : { output }),
});
export const needsHuman = (reason: string, output?: unknown): StepOutcome => ({
  status: "needs_human",
  reason: reason.slice(0, 2000),
  ...(output === undefined ? {} : { output }),
});

/** Usage of one task, summed by the ports. */
export type UsageMeter = TaskUsage;

/** Thrown by ports: the worker maps it to an outcome (quota → paused retry). */
export class PortError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly resetsAt: string | null = null,
  ) {
    super(message);
  }
}
