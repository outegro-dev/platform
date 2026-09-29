import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemScheduler } from "./scheduler.js";

const DAY_MS = 24 * 3600_000;
/** Node runs a setTimeout longer than this after 1 ms (TimeoutOverflowWarning). */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("system scheduler", () => {
  it("never hands the platform a delay it would cut to 1 ms", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clock = { now: () => new Date("2026-09-29T10:00:00.000Z") };
    const scheduler = new SystemScheduler(clock, () => undefined);
    // Premium bought today ends in 30 days: EntitlementWatch waits for it.
    const handle = scheduler.at(
      new Date(clock.now().getTime() + 30 * DAY_MS),
      () => undefined,
    );
    const delays = setTimeoutSpy.mock.calls.map(([, delay]) => Number(delay));
    handle.cancel();
    expect(delays.length).toBeGreaterThan(0);
    expect(Math.max(...delays)).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
  });

  it("runs a task due in 30 days then, and not before", () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T10:00:00.000Z") });
    const scheduler = new SystemScheduler(
      { now: () => new Date() },
      () => undefined,
    );
    const task = vi.fn();
    scheduler.at(new Date(Date.now() + 30 * DAY_MS), task);
    vi.advanceTimersByTime(MAX_TIMEOUT_MS);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * DAY_MS - MAX_TIMEOUT_MS - 1);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("a long timer can still be cancelled after it re-armed", () => {
    vi.useFakeTimers({ now: new Date("2026-09-29T10:00:00.000Z") });
    const scheduler = new SystemScheduler(
      { now: () => new Date() },
      () => undefined,
    );
    const task = vi.fn();
    const handle = scheduler.at(new Date(Date.now() + 40 * DAY_MS), task);
    vi.advanceTimersByTime(MAX_TIMEOUT_MS + 1);
    handle.cancel();
    vi.advanceTimersByTime(40 * DAY_MS);
    expect(task).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
