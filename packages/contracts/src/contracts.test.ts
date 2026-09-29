import { describe, expect, it } from "vitest";
import {
  anyEventSchema,
  billingGrantChanged,
  deadLetterQueueName,
  defineEvent,
  defineQueue,
  identityUserCreated,
  messageKeyFor,
  notificationRequested,
  permissionsOf,
  retryQueueName,
} from "./index.js";

const envelope = {
  eventId: "00000000-0000-4000-8000-000000000001",
  schemaVersion: 1,
  occurredAt: "2026-09-27T12:00:00.000Z",
  aggregateId: "00000000-0000-4000-8000-000000000002",
  aggregateVersion: 2,
  producer: "payments",
  correlationId: "corr-fixture-001",
  causationId: "cmd-fixture-001",
};

describe("event envelope", () => {
  it("parses the contract example for billing.grant.changed.v1", () => {
    const event = billingGrantChanged.schema.parse({
      ...envelope,
      type: "billing.grant.changed.v1",
      payload: {
        grantId: "00000000-0000-4000-8000-000000000002",
        userId: "00000000-0000-4000-8000-000000000003",
        service: "fixture-product",
        feature: "access",
        sourceType: "purchase",
        sourceId: "00000000-0000-4000-8000-000000000004",
        state: "active",
        validFrom: "2026-09-27T12:00:00.000Z",
        validUntil: "2026-10-27T12:00:00.000Z",
      },
    });
    expect(event.payload.state).toBe("active");
  });

  it("rejects a payload of another event type", () => {
    const result = identityUserCreated.schema.safeParse({
      ...envelope,
      producer: "identity",
      type: "billing.grant.changed.v1",
      payload: { userId: envelope.aggregateId, locale: "en", status: "active" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects timestamps with an offset and non-UUID ids", () => {
    expect(
      anyEventSchema.safeParse({
        ...envelope,
        type: "x.y.v1",
        occurredAt: "2026-09-27T12:00:00+03:00",
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      anyEventSchema.safeParse({
        ...envelope,
        eventId: "user-a",
        type: "x.y.v1",
        payload: {},
      }).success,
    ).toBe(false);
  });

  it("derives schemaVersion from the type suffix and refuses unversioned types", () => {
    expect(identityUserCreated.schemaVersion).toBe(1);
    expect(() =>
      defineEvent(
        "identity.user.created",
        "identity",
        identityUserCreated.payload,
      ),
    ).toThrow();
  });

  it("accepts notification template keys with or without a version", () => {
    const keyOk = (templateKey: string) =>
      notificationRequested.payload.safeParse({
        sourceEventId: envelope.eventId,
        templateKey,
        category: "billing",
        recipient: { userId: envelope.aggregateId },
        data: {},
      }).success;
    expect(keyOk("billing.payment-confirmed")).toBe(true);
    expect(keyOk("billing.payment-confirmed.v2")).toBe(true);
    for (const bad of ["billing", "Billing.x", "billing.x2", "billing.x.v2x"])
      expect(keyOk(bad), bad).toBe(false);
  });
});

describe("topology", () => {
  it("binds one queue per consumer with retry and dead-letter names", () => {
    const queue = defineQueue("notifications", "identity-events", [
      { producer: "identity", types: ["identity.user.created.v1"] },
    ]);
    expect(queue.name).toBe("notifications.identity-events");
    expect(queue.bindings).toEqual([
      { exchange: "identity.events", routingKey: "identity.user.created.v1" },
    ]);
    expect(retryQueueName(queue.name, 2)).toBe(
      "notifications.identity-events.retry.2",
    );
    expect(deadLetterQueueName(queue.name)).toBe(
      "notifications.identity-events.dlq",
    );
  });
});

describe("access", () => {
  it("denies unknown roles and never derives admin rights from anything else", () => {
    expect(permissionsOf(["pro", "subscriber"]).size).toBe(0);
    expect(permissionsOf(["support"]).has("roles.assign")).toBe(false);
    expect(permissionsOf(["owner"]).has("roles.assign")).toBe(true);
  });
});

describe("errors", () => {
  it("builds camelCase message keys", () => {
    expect(messageKeyFor("IDEMPOTENCY_CONFLICT")).toBe(
      "errors.idempotencyConflict",
    );
  });
});
