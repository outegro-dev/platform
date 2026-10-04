import { describe, expect, it, vi } from "vitest";
import { type SyncResult, SyncStatusStore } from "./sync-status-store";
import { deferred } from "./testing";

function store(online = true) {
  const connection = { online };
  return {
    sync: new SyncStatusStore({ isOnline: () => connection.online }),
    connection,
  };
}

describe("SyncStatusStore", () => {
  it("shows saving, then saved, and keeps nothing to retry", async () => {
    const { sync } = store();
    const answer = deferred<SyncResult>();
    const write = sync.run("card:a", () => answer.promise);
    expect(sync.statusOf("card:a")).toBe("saving");
    answer.resolve("saved");
    expect(await write).toBe("saved");
    expect(sync.statusOf("card:a")).toBe("saved");
    expect(sync.canRetry("card:a")).toBe(false);
    expect(sync.retry("card:a")).toBeNull();
  });

  it("retries a failed write by sending exactly the same operation", async () => {
    const { sync } = store();
    const operation = vi
      .fn<() => Promise<SyncResult>>()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("saved");
    await sync.run("exercise:q", operation);
    expect(sync.statusOf("exercise:q")).toBe("failed");
    expect(sync.canRetry("exercise:q")).toBe(true);
    await sync.retry("exercise:q");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(sync.statusOf("exercise:q")).toBe("saved");
  });

  it("sends nothing while offline, and sends it once back online", async () => {
    const { sync, connection } = store(false);
    const operation = vi.fn(async (): Promise<SyncResult> => "saved");
    expect(await sync.run("card:a", operation)).toBe("offline");
    expect(operation).not.toHaveBeenCalled();
    expect(sync.canRetry("card:a")).toBe(true);
    connection.online = true;
    await sync.retry("card:a");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sync.statusOf("card:a")).toBe("saved");
  });

  it("reads a write that threw as failed, or offline when the connection is gone", async () => {
    const { sync, connection } = store();
    await sync.run("a", async () => {
      throw new Error("network");
    });
    expect(sync.statusOf("a")).toBe("failed");
    await sync.run("b", async () => {
      connection.online = false;
      throw new Error("network");
    });
    expect(sync.statusOf("b")).toBe("offline");
  });

  it("drops a write the server refused for good: no retry can help", async () => {
    const { sync } = store();
    for (const refusal of ["forbidden", "not-found", "invalid"] as const) {
      await sync.run(refusal, async () => refusal);
      expect(sync.statusOf(refusal)).toBe(refusal);
      expect(sync.canRetry(refusal)).toBe(false);
    }
    await sync.run("session", async () => "signed-out");
    expect(sync.canRetry("session")).toBe(false);
  });

  it("lets a newer write under the same key win over a late answer", async () => {
    const { sync } = store();
    const older = deferred<SyncResult>();
    void sync.run("card:a", () => older.promise);
    await sync.run("card:a", async () => "saved");
    older.resolve("failed");
    await older.promise;
    await Promise.resolve();
    expect(sync.statusOf("card:a")).toBe("saved");
  });

  it("tallies the statuses of many keys and retries them together", async () => {
    const { sync } = store();
    const flaky = vi
      .fn<() => Promise<SyncResult>>()
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("saved");
    await sync.run("card:a", flaky);
    await sync.run("card:b", async () => "saved");
    await sync.run("card:c", async () => "forbidden");
    expect(sync.tally(["card:a", "card:b", "card:c", "card:none"])).toEqual({
      failed: 1,
      saved: 1,
      forbidden: 1,
    });
    sync.retryAll(["card:a", "card:b", "card:c"]);
    await vi.waitFor(() => expect(sync.statusOf("card:a")).toBe("saved"));
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});
