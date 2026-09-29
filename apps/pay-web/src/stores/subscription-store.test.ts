import { describe, expect, it, vi } from "vitest";
import type { CancelOutcome, Subscription } from "@/lib/payments/model";
import { SubscriptionStore } from "./subscription-store";

const active: Subscription = {
  id: "0b9f4c1e-7b1a-4c9e-8a53-0f2c7b0f5e22",
  orderId: "6f1c2c8e-8d2a-4a57-9d8e-2f1f8f0d3a11",
  productKey: "battleship-premium",
  title: { en: "Battleship Premium", ru: "Морской бой Premium" },
  state: "active",
  autoRenew: true,
  paidUntil: "2026-10-29T10:00:00.000Z",
  accessUntil: "2026-11-01T10:00:00.000Z",
  money: { minor: "5000", currency: "RUB", scale: 2 },
  periodicity: "MONTHLY",
  cancelRequestedAt: null,
  cancelledAt: null,
  expiredAt: null,
  createdAt: "2026-09-29T10:00:00.000Z",
};

const store = (cancel: (id: string) => Promise<CancelOutcome>, online = true) =>
  new SubscriptionStore(active, { cancel, isOnline: () => online });

describe("SubscriptionStore", () => {
  it("shows the confirmed state the server returns and keeps the paid dates", async () => {
    const cancelling = {
      ...active,
      state: "cancelling" as const,
      autoRenew: false,
    };
    const cancel = vi.fn(async () => ({
      kind: "ok" as const,
      subscription: cancelling,
    }));
    const s = store(cancel);
    s.setDialogOpen(true);
    await s.confirm();
    expect(cancel).toHaveBeenCalledWith(active.id);
    expect(s.subscription).toEqual(cancelling);
    expect(s.subscription.accessUntil).toBe(active.accessUntil);
    expect(s.result).toBe("cancelling");
    expect(s.dialogOpen).toBe(false);
    expect(s.canCancel).toBe(false);
  });

  it("shows a pending cancellation while Lava has not confirmed", async () => {
    const requested = { ...active, state: "cancel_requested" as const };
    const s = store(async () => ({ kind: "ok", subscription: requested }));
    await s.confirm();
    expect(s.result).toBe("cancel_requested");
    expect(s.subscription.state).toBe("cancel_requested");
    expect(s.canCancel).toBe(false);
  });

  it("says nothing changed when the server kept the state", async () => {
    const s = store(async () => ({
      kind: "ok",
      subscription: { ...active, state: "expired", autoRenew: false },
    }));
    await s.confirm();
    expect(s.result).toBe("unchanged");
  });

  it("keeps the old state on an outage and allows a safe retry", async () => {
    const cancel = vi
      .fn<(id: string) => Promise<CancelOutcome>>()
      .mockResolvedValueOnce({ kind: "unavailable" })
      .mockResolvedValueOnce({
        kind: "ok",
        subscription: { ...active, state: "cancelling", autoRenew: false },
      });
    const s = store(cancel);
    s.setDialogOpen(true);
    await s.confirm();
    expect(s.problem).toBe("unavailable");
    expect(s.subscription).toBe(active);
    expect(s.dialogOpen).toBe(true);
    await s.confirm();
    expect(s.problem).toBeNull();
    expect(s.result).toBe("cancelling");
  });

  it.each([
    [{ kind: "unauthorized" } as const, "signed-out"],
    [{ kind: "not-found" } as const, "gone"],
  ])("maps %o to %s", async (outcome, problem) => {
    const s = store(async () => outcome);
    await s.confirm();
    expect(s.problem).toBe(problem);
  });

  it("treats a failed request as unknown, not as success", async () => {
    const s = store(async () => {
      throw new Error("network");
    });
    await s.confirm();
    expect(s.problem).toBe("unavailable");
    expect(s.result).toBeNull();
  });

  it("sends nothing while offline", async () => {
    const cancel = vi.fn(
      async (): Promise<CancelOutcome> => ({ kind: "unavailable" }),
    );
    const s = store(cancel, false);
    await s.confirm();
    expect(cancel).not.toHaveBeenCalled();
    expect(s.problem).toBe("offline");
  });

  it("runs one command at a time and keeps the dialog while it runs", async () => {
    let finish: (value: CancelOutcome) => void = () => {};
    const cancel = vi.fn(
      () =>
        new Promise<CancelOutcome>((done) => {
          finish = done;
        }),
    );
    const s = store(cancel);
    s.setDialogOpen(true);
    const first = s.confirm();
    void s.confirm();
    s.setDialogOpen(false);
    expect(s.pending).toBe(true);
    expect(s.dialogOpen).toBe(true);
    finish({
      kind: "ok",
      subscription: { ...active, state: "cancelling", autoRenew: false },
    });
    await first;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(s.pending).toBe(false);
  });
});
