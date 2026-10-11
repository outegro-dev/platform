import { Logger } from "@nestjs/common";
import { ManualClock } from "@outegro/nest-common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EduDatabase } from "../common/database.js";
import { ScriptedModel } from "../test/scripted-model.js";
import { AssistCache, CACHE_SWEEP_INTERVAL_MS } from "./cache.js";

/**
 * When the cache looks for stale answers: at start, then once a day, never
 * in SAFE_MODE. What a sweep drops is checked on PostgreSQL in assist.test.ts.
 */

const DAY = CACHE_SWEEP_INTERVAL_MS;

/** A cache whose prune is `prune` (no database), and the spy on it. */
function cacheWith(prune: () => Promise<number> = async () => 0) {
  const cache = new AssistCache(
    {} as EduDatabase,
    new ManualClock(),
    new ScriptedModel(),
  );
  return { cache, prune: vi.spyOn(cache, "prune").mockImplementation(prune) };
}

let safeMode: string | undefined;
beforeEach(() => {
  safeMode = process.env.SAFE_MODE;
  process.env.SAFE_MODE = "false";
  vi.useFakeTimers();
});
afterEach(() => {
  if (safeMode === undefined) delete process.env.SAFE_MODE;
  else process.env.SAFE_MODE = safeMode;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the sweep of stale answers", () => {
  it("runs when the service starts and once a day after, until it stops", async () => {
    const { cache, prune } = cacheWith();
    cache.onApplicationBootstrap();
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY - 1);
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(prune).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(prune).toHaveBeenCalledTimes(3);
    cache.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(prune).toHaveBeenCalledTimes(3);
  });

  it("logs how many answers it dropped, and a failure by kind alone; the next day it runs again", async () => {
    const logged = vi
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    const failed = vi
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const results = [
      async () => 3,
      async () => {
        throw Object.assign(new Error("connection to 10.0.0.5 lost"), {
          code: "ECONNRESET",
        });
      },
      async () => 0,
    ];
    const { cache, prune } = cacheWith(async () => {
      const next = results.shift();
      if (!next) throw new Error("no more sweeps expected");
      return next();
    });
    cache.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(0);
    expect(logged.mock.calls).toEqual([
      [{ dropped: 3 }, "Stale answers dropped"],
    ]);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(failed.mock.calls).toEqual([
      [{ error: { name: "Error", code: "ECONNRESET" } }, "Cache sweep failed"],
    ]);
    // Nothing dropped is nothing to log.
    await vi.advanceTimersByTimeAsync(DAY);
    expect(prune).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    cache.onApplicationShutdown();
  });

  it("stays off in SAFE_MODE", async () => {
    process.env.SAFE_MODE = "true";
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { cache, prune } = cacheWith();
    cache.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(prune).not.toHaveBeenCalled();
    cache.onApplicationShutdown();
  });
});
