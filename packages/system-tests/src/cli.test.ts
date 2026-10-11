import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { explain, finished, untilDone } from "./cli.js";

/* The stack's one-shot commands, on tiny Node scripts instead of services. */

const node = (script: string) =>
  spawn(process.execPath, ["-e", script], {
    stdio: ["ignore", "pipe", "pipe"],
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("finished", () => {
  it("keeps the exit code and everything the command printed", async () => {
    const run = await finished(
      node("console.log('granted?'); console.error('boom'); process.exit(3)"),
    );
    expect(run).toMatchObject({
      code: 3,
      stdout: "granted?\n",
      stderr: "boom\n",
      timedOut: false,
    });
    const message = explain("grant-owner", run);
    expect(message).toContain("grant-owner exited with code 3");
    expect(message).toContain("--- stdout ---\ngranted?");
    expect(message).toContain("--- stderr ---\nboom");
  });

  it("kills a command that outlives its timeout and says so", async () => {
    const run = await finished(
      node("console.log('started'); setInterval(() => {}, 1000)"),
      2000,
    );
    expect(run.timedOut).toBe(true);
    expect(run.code).not.toBe(0);
    expect(explain("migrations", run)).toContain(
      "migrations was killed after its timeout\n--- stdout ---\nstarted",
    );
  });
});

describe("untilDone", () => {
  it("accepts the effect although the command crashed afterwards, and warns with its output", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let starts = 0;
    await untilDone(
      "grant-owner",
      () => {
        starts++;
        return node("console.error('Channel ended'); process.exit(1)");
      },
      async () => true,
    );
    expect(starts).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain(
      "grant-owner made its change but exited with code 1",
    );
    expect(warn.mock.calls[0]?.[0]).toContain("Channel ended");
  });

  it("repeats a run without effect and then fails with every attempt's output", async () => {
    let starts = 0;
    const failed = untilDone(
      "grant-owner",
      () => {
        starts++;
        return node(`console.error('attempt ${starts}'); process.exit(1)`);
      },
      async () => false,
      { attempts: 2 },
    );
    await expect(failed).rejects.toThrow(
      /grant-owner did not take effect in 2 attempts[\s\S]*\(attempt 1\/2\) exited with code 1[\s\S]*attempt 1[\s\S]*\(attempt 2\/2\) exited with code 1[\s\S]*attempt 2/,
    );
    expect(starts).toBe(2);
  });

  it("stops repeating once a later attempt takes effect", async () => {
    let starts = 0;
    await untilDone(
      "grant-owner",
      () => {
        starts++;
        return node("process.exit(0)");
      },
      async () => starts === 2,
    );
    expect(starts).toBe(2);
  });
});
