import type { ChildProcess } from "node:child_process";

/**
 * One-shot commands the stack runs: migrations and operator CLIs. A failure
 * must say why, so every run keeps what the command printed.
 */
export type Finished = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** Killed for running longer than it was given. */
  timedOut: boolean;
};

/** Waits for the command to end; one still running after `timeoutMs` is killed. */
export function finished(
  child: ChildProcess,
  timeoutMs = 60_000,
): Promise<Finished> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);
  return new Promise((resolve) => {
    const done = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join(""),
        timedOut,
      });
    };
    // `close`, not `exit`: the output is complete only once stdio is closed.
    child.once("close", done);
    child.once("error", (error) => {
      stderr.push(String(error));
      done(null, null);
    });
  });
}

const tail = (text: string, max = 4000) =>
  text.length > max ? `…${text.slice(-max)}` : text;

/** "<what> exited with code 1", then what it printed, for an error message. */
export function explain(what: string, run: Finished) {
  const ended = run.timedOut
    ? "was killed after its timeout"
    : run.signal
      ? `was killed by ${run.signal}`
      : `exited with code ${run.code}`;
  return [
    `${what} ${ended}`,
    `--- stdout ---\n${tail(run.stdout.trim()) || "(empty)"}`,
    `--- stderr ---\n${tail(run.stderr.trim()) || "(empty)"}`,
  ].join("\n");
}

/**
 * Runs a command until `done` sees its effect, at most `attempts` times.
 * The effect decides, not the exit code: a command that made its change and
 * then failed on its way out counts as done, with a warning that carries its
 * output. Throws with the output of every attempt.
 */
export async function untilDone(
  what: string,
  start: () => ChildProcess,
  done: () => Promise<boolean>,
  { attempts = 3, timeoutMs = 60_000 } = {},
) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const run = await finished(start(), timeoutMs);
    if (await done()) {
      if (run.code !== 0)
        console.warn(explain(`${what} made its change but`, run));
      return;
    }
    failures.push(explain(`${what} (attempt ${attempt}/${attempts})`, run));
  }
  throw new Error(
    `${what} did not take effect in ${attempts} attempts\n\n${failures.join("\n\n")}`,
  );
}
