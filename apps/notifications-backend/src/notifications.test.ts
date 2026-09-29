import { randomUUID } from "node:crypto";
import { DATABASE, HealthRegistry, Messaging } from "@outegro/nest-common";
import { idLikeLabelValues, metricValue } from "@outegro/nest-common/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PermanentDeliveryError } from "./channels/providers.js";
import type { NotificationsDatabase } from "./common/database.js";
import { deliveries, inboxItems, intents, outbox } from "./db/schema.js";
import { DeliveryWorker } from "./delivery/delivery.worker.js";
import { IntentsService } from "./intents/intents.service.js";
import { RecipientsService } from "./recipients/recipients.service.js";
import {
  type Harness,
  intentEvent,
  startHarness,
  userEvents,
} from "./test/harness.js";

let h: Harness;
let db: NotificationsDatabase["db"];
let worker: DeliveryWorker;
let intentsService: IntentsService;
let recipientsService: RecipientsService;

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<NotificationsDatabase>(DATABASE).db;
  worker = h.app.get(DeliveryWorker);
  intentsService = h.app.get(IntentsService);
  recipientsService = h.app.get(RecipientsService);
});
afterAll(() => h?.close());
beforeEach(() => {
  h.clock.set(new Date());
  h.email.fail = null;
});

async function newUser(locale: "en" | "ru" = "en") {
  const userId = randomUUID();
  const email = `u.${userId.slice(0, 8)}@example.test`;
  for (const event of userEvents(userId, email, locale))
    await recipientsService.apply(event);
  return { userId, email };
}
const deliveryOf = async (
  userId: string,
  channel: "email" | "telegram" = "email",
) =>
  (
    await db.select().from(deliveries).where(eq(deliveries.userId, userId))
  ).find((d) => d.channel === channel);
const security = (
  userId: string,
  extra: Partial<Parameters<typeof intentEvent>[0]> = {},
) =>
  intentEvent({
    userId,
    templateKey: "security.session-revoked",
    category: "security",
    data: { reason: "reuse_detected", ip: "203.0.113.7" },
    ...extra,
  });

// First, while no other test has left deliveries behind.
describe("delivery metrics (OPS-04)", () => {
  it("counts outcomes by channel and shows the queue and its oldest delivery", async () => {
    const outcomes = () =>
      Promise.all(
        ["sent", "retried", "failed"].map((outcome) =>
          h.metric("notifications_deliveries_total", {
            channel: "email",
            outcome,
          }),
        ),
      );
    const queue = (channel: string) =>
      Promise.all([
        h.metric("notifications_deliveries_queued", { channel }),
        h.metric("notifications_delivery_oldest_queued_age_seconds", {
          channel,
        }),
      ]);
    const [sent = 0, retried = 0, failed = 0] = await outcomes();
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    h.clock.advance(30_000);
    expect(await queue("email")).toEqual([1, 30]);
    expect(await queue("telegram")).toEqual([0, 0]);

    h.email.fail = new Error("503 from provider");
    await worker.tick();
    h.email.fail = null;
    h.clock.advance(15_001);
    await worker.tick();
    const other = await newUser();
    await intentsService.accept(
      security(other.userId, { channels: ["email"] }),
    );
    h.email.fail = new PermanentDeliveryError("invalid_to_address");
    await worker.tick();
    expect(await outcomes()).toEqual([sent + 1, retried + 1, failed + 1]);
    expect(await queue("email")).toEqual([0, 0]);
  });
});

describe("intents (N-01)", () => {
  it("TC-N-01-01: the same source event twice creates one notification", async () => {
    const { userId } = await newUser();
    const event = security(userId);
    expect(await intentsService.accept(event)).toBe("processed");
    expect(await intentsService.accept(event)).toBe("duplicate");
    // A different event id carrying the same sourceEventId is also a duplicate.
    const again = security(userId, {
      sourceEventId: event.payload.sourceEventId,
    });
    await intentsService.accept(again);
    expect(
      await db.select().from(intents).where(eq(intents.userId, userId)),
    ).toHaveLength(1);
    expect(
      await db.select().from(inboxItems).where(eq(inboxItems.userId, userId)),
    ).toHaveLength(1);
    const rows = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.userId, userId));
    expect(rows.map((d) => d.channel).sort()).toEqual(["email", "telegram"]);
  });

  it("TC-N-01-03: email accepted and inbox unread are separate states", async () => {
    const { userId, email } = await newUser("ru");
    await intentsService.accept(security(userId));
    await worker.tick();
    expect((await deliveryOf(userId))?.state).toBe("accepted");
    const sent = h.email.sent.find((m) => m.to === email);
    expect(sent?.subject).toContain("Сеанс завершён");
    // The email leads to the fix and to the channel settings.
    expect(sent?.html).toContain("https://id.outegro.dev/account/sessions");
    expect(sent?.text).toContain("https://id.outegro.dev/account/sessions");
    expect(sent?.html).toContain(
      "https://id.outegro.dev/account/notifications",
    );
    const token = await h.tokenFor(userId);
    const inbox = await h
      .http()
      .get("/v1/me/inbox")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(inbox.body.unreadCount).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({
      title: "Сеанс завершён",
      readAt: null,
    });
  });

  it("TC-N-01-02: a user cannot read or mark someone else's item", async () => {
    const owner = await newUser();
    const stranger = await newUser();
    await intentsService.accept(
      security(owner.userId, { channels: ["inbox"] }),
    );
    const [item] = await db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.userId, owner.userId));
    const strangerToken = await h.tokenFor(stranger.userId);
    await h
      .http()
      .post(`/v1/me/inbox/${item?.id}/read`)
      .set("authorization", `Bearer ${strangerToken}`)
      .expect(404);
    const ownerToken = await h.tokenFor(owner.userId);
    for (let i = 0; i < 2; i++) {
      await h
        .http()
        .post(`/v1/me/inbox/${item?.id}/read`)
        .set("authorization", `Bearer ${ownerToken}`)
        .expect(204);
    }
    const inbox = await h
      .http()
      .get("/v1/me/inbox")
      .set("authorization", `Bearer ${ownerToken}`);
    expect(inbox.body.unreadCount).toBe(0);
  });

  it("rejects a tampered inbox cursor as a bad request, not a server error", async () => {
    const { userId } = await newUser();
    const token = await h.tokenFor(userId);
    for (const raw of ["2026-01-01T00:00:00.000Z|not-a-uuid", "garbage"]) {
      await h
        .http()
        .get(`/v1/me/inbox?cursor=${Buffer.from(raw).toString("base64url")}`)
        .set("authorization", `Bearer ${token}`)
        .expect(400);
    }
  });

  it("rejects login-code templates on the broker path", async () => {
    const { userId } = await newUser();
    await expect(
      intentsService.accept(
        intentEvent({
          userId,
          templateKey: "auth.login-code",
          category: "auth",
          data: { code: "1" },
        }),
      ),
    ).rejects.toThrow("auth templates are private");
  });
});

describe("delivery (N-03)", () => {
  it("TC-N-03-01: two workers never claim the same delivery", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    const [a, b] = await Promise.all([worker.claim(10), worker.claim(10)]);
    const mine = [...a, ...b].filter((d) => d.userId === userId);
    expect(mine).toHaveLength(1);
  });

  it("TC-N-03-02: a retry after an unknown provider result reuses the idempotency key", async () => {
    const { userId, email } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    h.email.fail = new Error("socket hang up after request was sent");
    await worker.tick();
    expect((await deliveryOf(userId))?.state).toBe("retry_wait");
    h.email.fail = null;
    h.clock.advance(15_001);
    await worker.tick();
    const tries = h.email.attempts.filter((m) => m.to === email);
    expect(tries).toHaveLength(2);
    expect(new Set(tries.map((m) => m.idempotencyKey)).size).toBe(1);
    expect((await deliveryOf(userId))?.state).toBe("accepted");
  });

  it("TC-N-03-02: a crashed worker's lease expires and the delivery is resent with the same key", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    const [claimed] = (await worker.claim(10)).filter(
      (d) => d.userId === userId,
    );
    expect(claimed?.state).toBe("leased");
    h.clock.advance(61_000); // lease is 60 s
    await worker.tick();
    const delivery = await deliveryOf(userId);
    expect(delivery).toMatchObject({ state: "accepted", attempts: 2 });
  });

  it("TC-N-03-03: a permanent error fails at once and publishes the state", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    h.email.fail = new PermanentDeliveryError("invalid_to_address");
    await worker.tick();
    const delivery = await deliveryOf(userId);
    expect(delivery).toMatchObject({
      state: "failed",
      attempts: 1,
      lastError: "invalid_to_address",
    });
    const events = await db
      .select({ state: sql<string>`${outbox.envelope}->'payload'->>'state'` })
      .from(outbox)
      .where(
        sql`${outbox.envelope}->'payload'->>'deliveryId' = ${delivery?.id}`,
      );
    expect(events).toEqual([{ state: "failed" }]);
  });

  it("follows the 15 s / 1 min / 5 min / 15 min schedule, then gives up", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    h.email.fail = new Error("503 from provider");
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      await worker.tick();
      const d = await deliveryOf(userId);
      if (d?.state === "retry_wait") {
        waits.push(d.nextAttemptAt.getTime() - h.clock.now().getTime());
        h.clock.set(d.nextAttemptAt);
      }
    }
    expect(waits).toEqual([15_000, 60_000, 300_000, 900_000]);
    expect(await deliveryOf(userId)).toMatchObject({
      state: "failed",
      attempts: 5,
    });
  });

  it("expires messages that are no longer relevant", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    h.clock.advance(25 * 3600_000);
    await worker.tick();
    expect((await deliveryOf(userId))?.state).toBe("expired");
  });

  it("waits for Identity when the recipient is not known yet", async () => {
    const userId = randomUUID();
    await intentsService.accept(security(userId, { channels: ["email"] }));
    await worker.tick();
    expect((await deliveryOf(userId))?.state).toBe("retry_wait");
  });

  it("fails Telegram deliveries when no chat is linked", async () => {
    const { userId } = await newUser();
    await intentsService.accept(security(userId, { channels: ["telegram"] }));
    await worker.tick();
    expect(await deliveryOf(userId, "telegram")).toMatchObject({
      state: "failed",
      lastError: "telegram not linked",
    });
  });
});

describe("preferences", () => {
  it("honours opt-outs but not for mandatory channels", async () => {
    const { userId, email } = await newUser();
    const token = await h.tokenFor(userId);
    const auth = { authorization: `Bearer ${token}` };
    const current = (
      await h
        .http()
        .get("/v1/me/notification-preferences")
        .set(auth)
        .expect(200)
    ).body;
    await h
      .http()
      .patch("/v1/me/notification-preferences")
      .set(auth)
      .send({
        expectedVersion: current.version,
        items: [{ category: "security", channel: "email", enabled: false }],
      })
      .expect(422);
    await h
      .http()
      .patch("/v1/me/notification-preferences")
      .set(auth)
      .send({
        expectedVersion: current.version,
        items: [{ category: "service", channel: "email", enabled: false }],
      })
      .expect(200);
    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "service.message",
        category: "service",
        data: { title: "Maintenance", body: "Tonight 02:00 UTC" },
      }),
    );
    await worker.tick();
    expect(await deliveryOf(userId)).toMatchObject({
      state: "failed",
      lastError: "disabled by user",
    });
    expect(h.email.sent.some((m) => m.to === email)).toBe(false);
    const inbox = await h.http().get("/v1/me/inbox").set(auth).expect(200);
    expect(inbox.body.items[0].title).toBe("Maintenance");
  });

  it("requires a token for user endpoints", async () => {
    await h.http().get("/v1/me/inbox").expect(401);
  });
});

describe("broker integration", () => {
  it("consumes Identity events and intents from RabbitMQ end to end", async () => {
    const publisher = new Messaging(
      { url: h.rabbitUrl, service: "identity" },
      new HealthRegistry(),
    );
    const userId = randomUUID();
    const email = `broker.${userId.slice(0, 8)}@example.test`;
    for (const event of userEvents(userId, email))
      await publisher.publish("identity.events", event);
    await publisher.publish(
      "identity.events",
      security(userId, { channels: ["email"] }),
    );
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await worker.tick();
      if (h.email.sent.some((m) => m.to === email)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(h.email.sent.some((m) => m.to === email)).toBe(true);
    await publisher.onApplicationShutdown();
  });
});

describe("scrape after every flow above (OPS-04)", () => {
  it("labels routes by template and never carries ids or emails", async () => {
    const scrape = await h.scrape();
    expect(
      metricValue(scrape, "http_server_requests_total", {
        method: "POST",
        route: "/v1/me/inbox/:id/read",
      }),
    ).toBeGreaterThan(0);
    expect(
      metricValue(scrape, "messaging_events_consumed_total", {
        queue: "notifications.intents",
        outcome: "processed",
      }),
    ).toBeGreaterThan(0);
    expect(scrape).toContain("outbox_pending_events{");
    expect(scrape).not.toContain("@example.test");
    expect(idLikeLabelValues(scrape)).toEqual([]);
  });
});
