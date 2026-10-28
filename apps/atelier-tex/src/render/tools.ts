import { spawn } from "node:child_process";
import { Injectable } from "@nestjs/common";

export type ToolResult = {
  /** Exit code; null when the process was killed. */
  code: number | null;
  /** stdout and stderr together, the last 256 KB. */
  output: string;
  timedOut: boolean;
};

export type ToolOptions = {
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
};

/** Runs xelatex and poppler; replaced by a fake in HTTP tests. */
export interface ToolRunner {
  run(
    command: string,
    args: string[],
    options: ToolOptions,
  ): Promise<ToolResult>;
}
export const TOOL_RUNNER = Symbol("TOOL_RUNNER");

const OUTPUT_LIMIT = 256 * 1024;
const isWindows = process.platform === "win32";

/**
 * Spawns without a shell (arguments pass verbatim, backslashes included).
 * On a timeout the whole process group is killed: xelatex pipes its output
 * into xdvipdfmx, which must not outlive it.
 */
@Injectable()
export class SpawnToolRunner implements ToolRunner {
  run(command: string, args: string[], options: ToolOptions) {
    return new Promise<ToolResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: !isWindows,
        windowsHide: true,
      });
      let output = "";
      let timedOut = false;
      const collect = (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > OUTPUT_LIMIT * 2)
          output = output.slice(-OUTPUT_LIMIT);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (!isWindows && child.pid) process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, options.timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ code: null, output: `${output}${error.message}`, timedOut });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, output: output.slice(-OUTPUT_LIMIT), timedOut });
      });
    });
  }
}

/** Every slot is taken and the queue is full. */
export class SlotsBusyError extends Error {
  constructor() {
    super("All TeX slots are busy");
  }
}

/** At most `size` jobs at once, at most `queueMax` waiting, first come first served. */
export class Slots {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly size: number,
    private readonly queueMax: number,
  ) {}

  get state() {
    return { active: this.active, waiting: this.waiting.length };
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.size) this.active++;
    else {
      if (this.waiting.length >= this.queueMax) throw new SlotsBusyError();
      // The finishing job hands its slot over: `active` stays the same.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
