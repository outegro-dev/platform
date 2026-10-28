import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { Slots, SlotsBusyError, SpawnToolRunner } from "./tools.js";

describe("SpawnToolRunner", () => {
  const runner = new SpawnToolRunner();
  const options = { cwd: tmpdir(), timeoutMs: 10_000 };

  it("passes arguments verbatim and collects both streams", async () => {
    const result = await runner.run(
      process.execPath,
      [
        "-e",
        "process.stdout.write(process.argv[1]); process.stderr.write('!')",
        "\\def\\x{1} $HOME `x`",
      ],
      options,
    );
    expect(result).toEqual({
      code: 0,
      output: "\\def\\x{1} $HOME `x`!",
      timedOut: false,
    });
  });

  it("kills a process that runs past its timeout", async () => {
    const started = Date.now();
    const result = await runner.run(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)"],
      { ...options, timeoutMs: 300 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("reports a missing binary as a failed run", async () => {
    const result = await runner.run("no-such-tool-atelier", [], options);
    expect(result.code).toBeNull();
    expect(result.timedOut).toBe(false);
  });
});

describe("Slots", () => {
  it("runs at most `size` jobs, queues `queueMax`, refuses the rest", async () => {
    const slots = new Slots(2, 1);
    const releases: (() => void)[] = [];
    let running = 0;
    let peak = 0;
    const job = () =>
      slots.run(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running--;
      });
    const jobs = [job(), job(), job()];
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(slots.state).toEqual({ active: 2, waiting: 1 });
    await expect(job()).rejects.toBeInstanceOf(SlotsBusyError);
    while (releases.length || running) {
      releases.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await Promise.all(jobs);
    expect(peak).toBe(2);
    expect(slots.state).toEqual({ active: 0, waiting: 0 });
  });

  it("frees the slot when a job throws", async () => {
    const slots = new Slots(1, 0);
    await expect(
      slots.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(slots.run(async () => 1)).resolves.toBe(1);
  });
});
