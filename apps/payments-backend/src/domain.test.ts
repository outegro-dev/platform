import { describe, expect, it } from "vitest";
import { factSchema } from "./domain/facts.js";
import {
  accessUntil,
  grantInForce,
  subscriptionLifecycle,
} from "./domain/lifecycle.js";
import { formatMinor, MoneyError, moneyDto, toMinor } from "./domain/money.js";
import { addMonthsUtc, paidInterval } from "./domain/periods.js";
import { normalizeLavaEvent, payloadHash } from "./lava/webhook-events.js";
import { lavaPayloads } from "./test/lava-payloads.js";

const at = new Date("2026-09-29T10:00:00.000Z");

describe("money (PAY-02)", () => {
  it("TC-PAY-02-02: decimal strings add up exactly, no binary float", () => {
    const sum = toMinor("0.10", "USD") + toMinor("0.20", "USD");
    expect(sum).toBe(30n);
    expect(formatMinor(sum, "USD")).toBe("0.30");
    // JSON numbers are read as the literal the sender wrote.
    expect(toMinor(0.59, "USD")).toBe(59n);
    expect(toMinor(40254.19, "RUB")).toBe(4025419n);
    expect(toMinor(50, "RUB")).toBe(5000n);
    expect(toMinor("50.000", "RUB")).toBe(5000n);
    expect(moneyDto(59n, "USD")).toEqual({
      minor: "59",
      currency: "USD",
      scale: 2,
    });
  });

  it("refuses values it would have to round or cannot read", () => {
    for (const bad of ["0.001", "-1", "1e3", "abc", "", " 1.2.3"]) {
      expect(() => toMinor(bad, "USD")).toThrow(MoneyError);
    }
    expect(() => toMinor(0.1 + 0.2, "USD")).toThrow(MoneyError);
    expect(() => toMinor(1e21, "USD")).toThrow(MoneyError);
    expect(() => toMinor(Number.NaN, "USD")).toThrow(MoneyError);
  });
});

describe("periods and access", () => {
  it("adds calendar months in UTC and clamps the day", () => {
    expect(
      addMonthsUtc(new Date("2026-01-31T12:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-02-28T12:00:00.000Z");
    expect(
      addMonthsUtc(new Date("2026-12-15T00:00:00.000Z"), 1).toISOString(),
    ).toBe("2027-01-15T00:00:00.000Z");
  });

  it("depends only on the payment, so a repeat cannot add days", () => {
    const first = paidInterval({
      paidUntil: null,
      paidAt: at,
      now: at,
      periodicity: "MONTHLY",
    });
    expect(first.end.toISOString()).toBe("2026-10-29T10:00:00.000Z");
    // An early renewal continues from the paid end...
    const early = new Date(first.end.getTime() - 3_600_000);
    const renewal = paidInterval({
      paidUntil: first.end,
      paidAt: early,
      now: early,
      periodicity: "MONTHLY",
    });
    expect(renewal.start).toEqual(first.end);
    expect(renewal.end.toISOString()).toBe("2026-11-29T10:00:00.000Z");
    // ...a lapsed one starts at the payment; a future timestamp is clamped to now.
    const late = new Date(first.end.getTime() + 5 * 86_400_000);
    expect(
      paidInterval({
        paidUntil: first.end,
        paidAt: late,
        now: late,
        periodicity: "MONTHLY",
      }).start,
    ).toEqual(late);
    expect(
      paidInterval({
        paidUntil: null,
        paidAt: new Date(at.getTime() + 60_000),
        now: at,
        periodicity: "MONTHLY",
      }).start,
    ).toEqual(at);
  });

  it("uses a half-open interval: at validUntil access is gone (INV-12)", () => {
    const validUntil = accessUntil(at, 3);
    expect(validUntil.toISOString()).toBe("2026-10-02T10:00:00.000Z");
    const grant = { state: "active", validFrom: at, validUntil };
    expect(grantInForce(grant, new Date(validUntil.getTime() - 1))).toBe(true);
    expect(grantInForce(grant, validUntil)).toBe(false);
    expect(grantInForce({ ...grant, validUntil: null }, validUntil)).toBe(true);
    expect(grantInForce({ ...grant, state: "revoked" }, at)).toBe(false);
  });

  it("moves subscription states only where chapter 6.7 allows", () => {
    expect(subscriptionLifecycle.renewalFailed("active")).toBe("past_due");
    expect(subscriptionLifecycle.renewalFailed("cancelling")).toBeNull();
    expect(subscriptionLifecycle.renewed("past_due")).toBe("active");
    expect(subscriptionLifecycle.renewed("cancelling")).toBe("cancelling");
    expect(subscriptionLifecycle.cancelRequested("expired")).toBeNull();
    expect(subscriptionLifecycle.cancelled("cancel_requested")).toBe(
      "cancelling",
    );
    expect(subscriptionLifecycle.periodEnded("active", false)).toBeNull();
    expect(subscriptionLifecycle.accessEnded("expired")).toBeNull();
  });
});

describe("Lava webhook normalizer (PAY-01)", () => {
  it("TC-PAY-01-01: reads both documented shapes without losing source ids", () => {
    const flat = normalizeLavaEvent(
      lavaPayloads.paymentSuccess({
        contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc",
        email: "buyer@example.test",
        amount: 40254.19,
        currency: "RUB",
        at,
      }),
    );
    expect(flat).toMatchObject({
      status: "received",
      key: "payment.success:7ea82675-4ded-4133-95a7-a6efbaf165cc:completed",
      fact: {
        kind: "payment",
        outcome: "success",
        recurring: false,
        contractId: "7ea82675-4ded-4133-95a7-a6efbaf165cc",
        amount: "40254.19",
        currency: "RUB",
        occurredAt: at.toISOString(),
      },
    });
    const refund = normalizeLavaEvent(
      lavaPayloads.refund({
        eventId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        refundId: "r-1",
        tierId: "836b9fc5-7ae9-4a27-9642-592bc44072b7",
        email: "buyer@example.test",
        amount: 40254.19,
        currency: "RUB",
        at,
      }),
    );
    expect(refund).toMatchObject({
      status: "received",
      key: "event:a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      fact: {
        kind: "refund",
        refundId: "r-1",
        refundType: "full",
        offerId: "836b9fc5-7ae9-4a27-9642-592bc44072b7",
        contractId: null,
      },
    });
    const renewal = normalizeLavaEvent(
      lavaPayloads.renewalSuccess({
        contractId: "d41db415-ad71-4f2a-8d8c-27eefee91e66",
        parentContractId: "c5a0cacc-3453-44b0-9532-aa492f1ba191",
        email: "buyer@example.test",
        amount: 2049.85,
        currency: "RUB",
        at,
      }),
    );
    expect(renewal).toMatchObject({
      status: "received",
      parentContractId: "c5a0cacc-3453-44b0-9532-aa492f1ba191",
      fact: { recurring: true, outcome: "success" },
    });
    for (const event of [flat, refund, renewal]) {
      if (event.status === "received")
        expect(factSchema.parse(event.fact)).toEqual(event.fact);
    }
  });

  it("TC-PAY-01-02: an authenticated unknown type is quarantined, not paid", () => {
    expect(
      normalizeLavaEvent({
        eventType: "payout.created",
        contractId: "x",
        amount: 1,
      }),
    ).toMatchObject({
      status: "quarantined",
      type: "unknown",
      rawType: "payout.created",
    });
    expect(
      normalizeLavaEvent({
        event_id: "e-1",
        event_type: "dispute.won",
        data: {},
      }),
    ).toMatchObject({ status: "quarantined", key: "event:e-1" });
  });

  it("TC-PAY-01-03: a damaged payload is an explicit schema error", () => {
    const base = lavaPayloads.paymentSuccess({
      contractId: "c-1",
      email: "buyer@example.test",
      amount: 0.59,
      currency: "USD",
      at,
    });
    const cases = [
      { ...base, amount: "a lot" },
      { ...base, contractId: 42 },
      { ...base, amount: 0.591 },
      { ...base, currency: "GBP" },
      { ...base, status: "failed" },
      { ...base, eventType: "subscription.recurring.payment.success" },
      "not an object",
      null,
    ];
    for (const payload of cases) {
      const event = normalizeLavaEvent(payload);
      expect(event.status).toBe("invalid");
      expect(event).not.toHaveProperty("fact");
    }
    // Problems are named by path; payload values (emails) never appear.
    const invalid = normalizeLavaEvent({ ...base, amount: "a lot" });
    expect(invalid.status === "invalid" && invalid.note).toContain("amount");
    expect(JSON.stringify(invalid)).not.toContain("buyer@example.test");
  });

  it("TC-PAY-04-03: key order and whitespace do not change the key or the hash", () => {
    const payload = lavaPayloads.paymentSuccess({
      contractId: "c-2",
      email: "buyer@example.test",
      amount: 0.59,
      currency: "USD",
      at,
    });
    const reordered = JSON.parse(
      JSON.stringify(
        Object.fromEntries(Object.entries(payload).reverse()),
        null,
        4,
      ),
    );
    expect(normalizeLavaEvent(reordered).key).toBe(
      normalizeLavaEvent(payload).key,
    );
    expect(payloadHash(reordered)).toBe(payloadHash(payload));
  });
});
