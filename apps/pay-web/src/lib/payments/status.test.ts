import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";
import type { Order, Subscription } from "./model";
import { subscriptionStates } from "./model";
import {
  accessPhase,
  canCancel,
  graceDays,
  groupSubscriptions,
  isSettled,
  isStalePending,
  type OrderPhase,
  orderPhase,
  orderTimeline,
  pendingDetail,
  subscriptionNote,
} from "./status";

const access = {
  service: "battleship",
  feature: "premium",
  state: "active" as const,
  validFrom: "2026-09-01T10:02:00.000Z",
  validUntil: "2026-10-04T10:02:00.000Z",
};

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "o",
  productKey: "battleship-premium",
  title: { en: "Battleship Premium", ru: "Морской бой Premium" },
  kind: "subscription",
  status: "pending",
  money: { minor: "5000", currency: "RUB", scale: 2 },
  createdAt: "2026-09-01T10:00:00.000Z",
  paidAt: null,
  checkout: { state: "ready", paymentUrl: "https://app.lava.top/pay/1" },
  subscriptionId: null,
  access: null,
  ...overrides,
});

/** Every "a.b.c" leaf key of a messages file. */
function keys(tree: object, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}
const has = (tree: object, path: string) => keys(tree).includes(path);

describe("order wording", () => {
  it.each<[Partial<Order>, OrderPhase]>([
    [{ status: "pending" }, "processing"],
    [{ status: "paid", access: null }, "activating"],
    [{ status: "paid", access }, "paid"],
    [{ status: "failed" }, "failed"],
    [
      { status: "refunded", access: { ...access, state: "revoked" } },
      "refunded",
    ],
    [{ status: "unknown" }, "unknown"],
  ])("%o reads as %s", (overrides, phase) => {
    expect(orderPhase(order(overrides))).toBe(phase);
  });

  it("calls a long-pending order 'awaiting payment', not 'processing'", () => {
    const now = Date.parse("2026-09-29T12:00:00.000Z");
    const fresh = order({ createdAt: "2026-09-29T11:30:00.000Z" });
    const abandoned = order({ createdAt: "2026-09-26T09:00:00.000Z" });
    expect(isStalePending(fresh, now)).toBe(false);
    expect(isStalePending(abandoned, now)).toBe(true);
    expect(orderPhase(abandoned, isStalePending(abandoned, now))).toBe(
      "unpaid",
    );
    // Staleness never hides a server answer.
    const paidLate = order({ ...abandoned, status: "paid", access });
    expect(isStalePending(paidLate, now)).toBe(false);
    expect(orderPhase(paidLate, true)).toBe("paid");
  });

  it("stops watching only when nothing more can happen", () => {
    expect(isSettled(order({ status: "pending" }))).toBe(false);
    // Paid, but the grant is still on its way: keep watching.
    expect(isSettled(order({ status: "paid", access: null }))).toBe(false);
    expect(isSettled(order({ status: "paid", access }))).toBe(true);
    expect(isSettled(order({ status: "failed" }))).toBe(true);
    expect(isSettled(order({ status: "refunded" }))).toBe(true);
    expect(isSettled(order({ status: "unknown" }))).toBe(false);
  });

  it("explains a pending order by its provider call", () => {
    expect(
      pendingDetail(
        order({ checkout: { state: "requesting", paymentUrl: null } }),
      ),
    ).toBe("preparing");
    expect(
      pendingDetail(
        order({ checkout: { state: "unknown", paymentUrl: null } }),
      ),
    ).toBe("verifying");
    expect(pendingDetail(order())).toBe("awaiting");
    expect(pendingDetail(order({ checkout: null }))).toBe("awaiting");
  });

  it("tells the story of a paid order", () => {
    const steps = orderTimeline(
      order({ status: "paid", paidAt: "2026-09-01T10:02:00.000Z", access }),
    );
    expect(steps.map((s) => [s.key, s.variant, s.state])).toEqual([
      ["created", "done", "done"],
      ["payment", "done", "done"],
      ["access", "done", "done"],
    ]);
    expect(steps[1]?.at).toBe("2026-09-01T10:02:00.000Z");
  });

  it("shows where a pending, lagging, failed or refunded order stands", () => {
    const states = (o: Order) =>
      orderTimeline(o).map((s) => `${s.key}:${s.variant}:${s.state}`);
    expect(states(order())).toEqual([
      "created:done:done",
      "payment:awaiting:current",
      "access:upcoming:upcoming",
    ]);
    expect(states(order({ status: "paid", access: null }))).toContain(
      "access:activating:current",
    );
    expect(states(order({ status: "failed" }))).toEqual([
      "created:done:done",
      "payment:failed:failed",
      "access:none:upcoming",
    ]);
    expect(states(order({ status: "refunded", access }))).toEqual([
      "created:done:done",
      "payment:done:done",
      "access:done:done",
      "refund:done:done",
    ]);
  });

  it("describes access honestly", () => {
    expect(accessPhase(order())).toBe("after-payment");
    expect(accessPhase(order({ status: "paid" }))).toBe("activating");
    expect(accessPhase(order({ status: "failed" }))).toBe("none");
    expect(accessPhase(order({ status: "paid", access }))).toBe("active-until");
    expect(
      accessPhase(
        order({ status: "paid", access: { ...access, validUntil: null } }),
      ),
    ).toBe("active-forever");
    expect(
      accessPhase(
        order({ status: "paid", access: { ...access, state: "expired" } }),
      ),
    ).toBe("expired");
    expect(
      accessPhase(
        order({ status: "refunded", access: { ...access, state: "revoked" } }),
      ),
    ).toBe("revoked");
  });
});

describe("subscription wording", () => {
  const sub = (overrides: Partial<Subscription> = {}): Subscription => ({
    id: "s",
    orderId: "o",
    productKey: "battleship-premium",
    title: null,
    state: "active",
    autoRenew: true,
    paidUntil: "2026-10-01T10:00:00.000Z",
    accessUntil: "2026-10-04T10:00:00.000Z",
    money: { minor: "5000", currency: "RUB", scale: 2 },
    periodicity: "MONTHLY",
    cancelRequestedAt: null,
    cancelledAt: null,
    expiredAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  });

  it("offers cancel only while the provider may still charge", () => {
    expect(canCancel(sub())).toBe(true);
    expect(canCancel(sub({ state: "past_due" }))).toBe(true);
    for (const state of [
      "pending",
      "cancel_requested",
      "cancelling",
      "expired",
      "suspended",
      "unknown",
    ] as const)
      expect(canCancel(sub({ state }))).toBe(false);
    expect(canCancel(sub({ autoRenew: false }))).toBe(false);
  });

  it("explains each state", () => {
    expect(subscriptionNote(sub())).toBe("renews");
    expect(subscriptionNote(sub({ autoRenew: false }))).toBe("ends");
    expect(subscriptionNote(sub({ state: "cancel_requested" }))).toBe(
      "cancel_requested",
    );
  });

  it("puts ended subscriptions last", () => {
    const { current, past } = groupSubscriptions([
      sub({ id: "a", state: "expired" }),
      sub({ id: "b" }),
      sub({ id: "c", state: "cancelling" }),
    ]);
    expect(current.map((s) => s.id)).toEqual(["b", "c"]);
    expect(past.map((s) => s.id)).toEqual(["a"]);
  });

  it("counts grace days between paid end and access end", () => {
    expect(graceDays(sub())).toBe(3);
    expect(graceDays(sub({ accessUntil: "2026-10-01T10:00:00.000Z" }))).toBe(0);
  });
});

describe("messages", () => {
  it("have the same keys in English and Russian", () => {
    expect(keys(ru).sort()).toEqual(keys(en).sort());
  });

  it("word every order, access and subscription state", () => {
    const phases: OrderPhase[] = [
      "processing",
      "unpaid",
      "activating",
      "paid",
      "failed",
      "refunded",
      "unknown",
    ];
    const notes = [
      "renews",
      "ends",
      ...subscriptionStates.filter((s) => s !== "active"),
      "unknown",
    ];
    const accessPhases = [
      "active-forever",
      "active-until",
      "activating",
      "after-payment",
      "none",
      "expired",
      "revoked",
      "unknown",
    ];
    const required = [
      ...phases.map((p) => `status.order.${p}`),
      ...[...subscriptionStates, "unknown"].map(
        (s) => `status.subscription.${s}`,
      ),
      ...notes.map((n) => `subscriptions.note.${n}`),
      ...accessPhases.map((a) => `access.${a}`),
    ];
    for (const messages of [en, ru])
      for (const path of required) expect(has(messages, path), path).toBe(true);
  });

  it("word every timeline step the orders can produce", () => {
    const samples: Order[] = [
      order(),
      order({ checkout: { state: "requesting", paymentUrl: null } }),
      order({ checkout: { state: "unknown", paymentUrl: null } }),
      order({ status: "paid", access: null }),
      order({ status: "paid", access }),
      order({ status: "failed" }),
      order({ status: "refunded", access }),
      order({ status: "unknown" }),
    ];
    for (const sample of samples)
      for (const step of orderTimeline(sample))
        for (const messages of [en, ru])
          expect(has(messages, `timeline.${step.key}.${step.variant}`)).toBe(
            true,
          );
  });
});
