import { ManualClock } from "@outegro/nest-common";
import { describe, expect, it, vi } from "vitest";
import { ManualScheduler } from "../test/manual-scheduler.js";
import { EntitlementWatch } from "./entitlement.watch.js";

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
});
