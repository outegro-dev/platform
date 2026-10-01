import { describe, expect, it } from "vitest";
import {
  anyEventSchema,
  billingGrantChanged,
  deadLetterQueueName,
  defineEvent,
  defineQueue,
  deviceOf,
  hasPlatformRole,
  identityUserCreated,
  messageKeyFor,
  notificationRequested,
  permissionsOf,
  platformRoles,
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

  it("reads only its own role table: names inherited from Object grant nothing", () => {
    const inherited = [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
    ];
    for (const role of inherited)
      expect([...permissionsOf([role])], role).toEqual([]);
    // Next to a real role they neither break nor widen it.
    expect([...permissionsOf([...inherited, "billing_operator"])]).toEqual([
      "billing.read",
      "subscriptions.cancel",
    ]);
  });

  it("opens monitoring to owners, auditors and service operators only", () => {
    const withMonitoring = Object.keys(platformRoles).filter((role) =>
      permissionsOf([role]).has("monitoring.read"),
    );
    expect(withMonitoring.sort()).toEqual([
      "auditor",
      "owner",
      "service_operator",
    ]);
    // Monitoring is read access: it brings no other permission with it.
    expect([...permissionsOf(["auditor"])].sort()).toEqual([
      "audit.read",
      "billing.read",
      "monitoring.read",
    ]);
    expect([...permissionsOf(["service_operator"])].sort()).toEqual([
      "events.replay",
      "monitoring.read",
      "services.flags",
      "services.read",
    ]);
  });

  it("lets owners and support remove a user's passkey, and nobody else", () => {
    const withPasskeys = Object.keys(platformRoles).filter((role) =>
      permissionsOf([role]).has("passkeys.revoke"),
    );
    expect(withPasskeys.sort()).toEqual(["owner", "support"]);
  });

  it("tells whether someone holds a platform role (admin console link)", () => {
    for (const role of Object.keys(platformRoles))
      expect(hasPlatformRole([role]), role).toBe(true);
    expect(hasPlatformRole(["subscriber", "billing_operator"])).toBe(true);
    expect(hasPlatformRole([])).toBe(false);
    expect(hasPlatformRole(null)).toBe(false);
    expect(hasPlatformRole(undefined)).toBe(false);
    // Paid access and made-up or inherited names never count as a role.
    expect(hasPlatformRole(["premium", "constructor", "__proto__"])).toBe(
      false,
    );
  });
});

describe("errors", () => {
  it("builds camelCase message keys", () => {
    expect(messageKeyFor("IDEMPOTENCY_CONFLICT")).toBe(
      "errors.idempotencyConflict",
    );
    expect(messageKeyFor("ALREADY_OWNED")).toBe("errors.alreadyOwned");
  });
});

describe("deviceOf", () => {
  it("names the browser and the system from a fixed list", () => {
    const cases: [string, ReturnType<typeof deviceOf>][] = [
      [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
        { browser: "Chrome", os: "Windows" },
      ],
      [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
        { browser: "Edge", os: "Windows" },
      ],
      [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15",
        { browser: "Safari", os: "macOS" },
      ],
      [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1",
        { browser: "Chrome", os: "iOS" },
      ],
      [
        "Mozilla/5.0 (Android 16; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0",
        { browser: "Firefox", os: "Android" },
      ],
      [
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0",
        { browser: "Opera", os: "Linux" },
      ],
    ];
    for (const [ua, expected] of cases)
      expect(deviceOf(ua), ua).toEqual(expected);
  });

  it("names nothing it does not know, and never repeats the header", () => {
    expect(deviceOf(null)).toEqual({ browser: null, os: null });
    expect(deviceOf("curl/8.9.1")).toEqual({ browser: null, os: null });
    expect(deviceOf("<script>alert(1)</script> Chrome/1")).toEqual({
      browser: "Chrome",
      os: null,
    });
  });
});
