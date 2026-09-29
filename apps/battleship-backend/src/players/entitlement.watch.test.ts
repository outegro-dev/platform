import { Logger } from "@nestjs/common";
import {
  type Correlation,
  currentCorrelation,
  runWithCorrelation,
} from "@outegro/db";
import { ManualClock } from "@outegro/nest-common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemScheduler } from "../domain/scheduler.js";
import { ManualScheduler } from "../test/manual-scheduler.js";
import { EntitlementWatch } from "./entitlement.watch.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const USER = "00000000-0000-4000-8000-00000000000a";

function watchWith(nextChange: () => Promise<Date | null>) {
  const clock = new ManualClock(new Date("2026-09-29T10:00:00.000Z"));
  const scheduler = new ManualScheduler(clock);
  const pushUpdate = vi.fn(async () => undefined);
  const online = new Set([USER]);
  const watch = new EntitlementWatch(
    { nextChange } as never,
    { pushUpdate } as never,
    { isOnline: (userId: string) => online.has(userId) } as never,
    scheduler,
  );
  return { clock, scheduler, pushUpdate, online, watch };
}

describe("entitlement watch", () => {
  it("two watches at once leave one timer, and going offline cancels it", async () => {
    const { clock, scheduler, pushUpdate, online, watch } = watchWith(
      async () => new Date(clock.now().getTime() + 3_600_000),
    );
    // A socket opens while a grant event for the same player lands.
    await Promise.all([watch.watch(USER), watch.watch(USER)]);
    expect(scheduler.pending).toBe(1);
    online.delete(USER);
    watch.unwatch(USER);
    expect(scheduler.pending).toBe(0);
    await scheduler.advance(3_600_000);
    expect(pushUpdate).not.toHaveBeenCalled();
  });

  it("a timer armed while handling a grant event runs, and logs, outside that event", async () => {
    // Real timers: they carry the async context they were armed in.
    const clock = new ManualClock(new Date());
    const scheduler = new SystemScheduler(clock, () => undefined);
    const inPush: (Correlation | undefined)[] = [];
    const inLog: (Correlation | undefined)[] = [];
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => {
      inLog.push(currentCorrelation());
    });
    const pushUpdate = vi.fn(async () => {
      inPush.push(currentCorrelation());
      throw new Error("player went away");
    });
    const watch = new EntitlementWatch(
      { nextChange: async () => new Date(clock.now().getTime() + 5) } as never,
      { pushUpdate } as never,
      { isOnline: () => true } as never,
      scheduler,
    );
    try {
      await runWithCorrelation(
        { correlationId: "grant-chain-0001", causationId: "grant-event-1" },
        () => watch.watch(USER),
      );
      await vi.waitFor(() => expect(inLog).toHaveLength(1));
      expect(inPush).toEqual([undefined]);
      expect(inLog).toEqual([undefined]);
    } finally {
      watch.unwatch(USER);
      scheduler.cancelAll();
    }
  });
});
