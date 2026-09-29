import { randomUUID } from "node:crypto";
import { DATABASE } from "@outegro/nest-common";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { maskEmail, redact } from "./admin/admin.controller.js";
import {
  PermanentDeliveryError,
  UnknownOutcomeError,
} from "./channels/providers.js";
import type { NotificationsDatabase } from "./common/database.js";
import { adminAudit, deliveries, intents, recipients } from "./db/schema.js";
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

beforeAll(async () => {
  h = await startHarness();
  db = h.app.get<NotificationsDatabase>(DATABASE).db;
  worker = h.app.get(DeliveryWorker);
  intentsService = h.app.get(IntentsService);
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
    await h.app.get(RecipientsService).apply(event);
  return { userId, email };
}
const auth = async (userId: string, roles: string[] = []) =>
  `Bearer ${await h.tokenFor(userId, roles)}`;

let nextUpdate = 1;
const message = (chatId: number, text: string, type = "private") => ({
  update_id: nextUpdate++,
  message: {
    message_id: nextUpdate,
    date: 0,
    chat: { id: chatId, type },
    from: { id: chatId, is_bot: false, first_name: "T", language_code: "en" },
    text,
  },
});
const hook = (body: unknown, secret: string | null = h.telegramSecret) => {
  const call = h.http().post("/webhooks/telegram");
  if (secret) call.set("x-telegram-bot-api-secret-token", secret);
  return call.send(body as object);
};
async function linkToken(userId: string) {
  const res = await h
    .http()
    .post("/v1/me/telegram/link")
    .set("authorization", await auth(userId))
    .expect(201);
  const url = new URL(res.body.url);
  expect(url.origin + url.pathname).toBe("https://t.me/outegro_test_bot");
  return url.searchParams.get("start") ?? "";
}
const status = async (userId: string) =>
  (
    await h
      .http()
      .get("/v1/me/telegram")
      .set("authorization", await auth(userId))
      .expect(200)
  ).body;
const repliesTo = (chatId: number) =>
  h.telegram.sent.filter((m) => m.chatId === String(chatId));

describe("Telegram linking (N-04)", () => {
  it("registers the webhook with its secret at startup", () => {
    expect(h.bot.webhooks).toEqual([
      { url: "https://hooks.outegro.test/telegram", secret: h.telegramSecret },
    ]);
  });

  it("links a chat through a one-time deep link, then delivers there", async () => {
    const { userId } = await newUser();
    expect(await status(userId)).toMatchObject({
      available: true,
      linked: false,
    });
    const token = await linkToken(userId);
    await hook(message(1001, `/start ${token}`)).expect(200);
    expect(await status(userId)).toMatchObject({ linked: true });
    expect(repliesTo(1001).at(-1)?.text).toContain("Connected");

    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "security.session-revoked",
        category: "security",
        channels: ["telegram"],
      }),
    );
    await worker.tick();
    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(
        and(eq(deliveries.userId, userId), eq(deliveries.channel, "telegram")),
      );
    expect(delivery?.state).toBe("accepted");
    expect(repliesTo(1001).at(-1)?.text).toContain("session");
  });

  it("N-06: tells the account owner about a linked chat by email and inbox, once", async () => {
    const { userId, email } = await newUser("ru");
    const token = await linkToken(userId);
    await hook(message(1501, `/start ${token}`)).expect(200);
    await hook(message(1502, `/start ${token}`)).expect(200); // used up
    await worker.tick();
    const sent = h.email.sent.filter((m) => m.to === email);
    expect(sent.map((m) => m.subject)).toEqual([
      "К аккаунту подключён Telegram",
    ]);
    expect(sent[0]?.html).toContain(
      'href="https://id.outegro.dev/account/notifications"',
    );
    // In the chat itself only the bot's own answer.
    expect(repliesTo(1501).map((m) => m.text)).toEqual([
      expect.stringContaining("Готово"),
    ]);
    const notices = await db
      .select()
      .from(intents)
      .where(
        and(
          eq(intents.userId, userId),
          eq(intents.templateKey, "security.telegram-linked.v1"),
        ),
      );
    expect(notices).toHaveLength(1);
    // Neither the chat nor the link token travels with the message.
    expect(notices[0]).toMatchObject({
      producer: "notifications",
      data: { at: h.clock.now().toISOString() },
    });
    expect(Object.keys(notices[0]?.data ?? {})).toEqual(["at"]);
    const inbox = await h
      .http()
      .get("/v1/me/inbox")
      .set("authorization", await auth(userId))
      .expect(200);
    expect(inbox.body.items[0]).toMatchObject({
      category: "security",
      title: "Telegram подключён",
    });
  });

  it("uses a token once and only for ten minutes", async () => {
    const { userId } = await newUser();
    const token = await linkToken(userId);
    await hook(message(1101, `/start ${token}`)).expect(200);
    await hook(message(1102, `/start ${token}`)).expect(200);
    expect(repliesTo(1102).at(-1)?.text).toContain("expired");
    const [row] = await db
      .select()
      .from(recipients)
      .where(eq(recipients.userId, userId));
    expect(row?.telegramChatId).toBe("1101");

    const late = await linkToken(userId);
    h.clock.advance(11 * 60_000);
    await hook(message(1103, `/start ${late}`)).expect(200);
    expect(repliesTo(1103).at(-1)?.text).toContain("expired");
  });

  it("rejects webhook calls without the right secret", async () => {
    await hook(message(1, "/start"), null).expect(401);
    await hook(message(1, "/start"), "x".repeat(64)).expect(401);
  });

  it("unlinks on /stop, on blocking the bot and from the account", async () => {
    const { userId } = await newUser("ru");
    await hook(message(1201, `/start ${await linkToken(userId)}`));
    expect(repliesTo(1201).at(-1)?.text).toContain("Готово");
    await hook(message(1201, "/stop")).expect(200);
    expect(await status(userId)).toMatchObject({ linked: false });
    expect(repliesTo(1201).at(-1)?.text).toContain("Отключено");

    await hook(message(1201, `/start ${await linkToken(userId)}`));
    await hook({
      update_id: nextUpdate++,
      my_chat_member: {
        chat: { id: 1201, type: "private" },
        new_chat_member: { status: "kicked" },
      },
    }).expect(200);
    expect(await status(userId)).toMatchObject({ linked: false });

    await hook(message(1201, `/start ${await linkToken(userId)}`));
    await h
      .http()
      .delete("/v1/me/telegram")
      .set("authorization", await auth(userId))
      .expect(204);
    expect(await status(userId)).toMatchObject({ linked: false });
  });

  it("moves a chat to the account that linked it last", async () => {
    const first = await newUser();
    const second = await newUser();
    await hook(message(1301, `/start ${await linkToken(first.userId)}`));
    await hook(message(1301, `/start ${await linkToken(second.userId)}`));
    expect(await status(first.userId)).toMatchObject({ linked: false });
    expect(await status(second.userId)).toMatchObject({ linked: true });
  });

  it("ignores group chats and malformed updates", async () => {
    const before = h.telegram.sent.length;
    await hook(message(-1401, "/start", "group")).expect(200);
    await hook({ nonsense: true }).expect(200);
    expect(h.telegram.sent.length).toBe(before);
  });
});

describe("admin console", () => {
  it("requires the matching permissions", async () => {
    const nobody = await auth(randomUUID());
    await h
      .http()
      .get("/v1/admin/overview")
      .set("authorization", nobody)
      .expect(403);
    await h
      .http()
      .get("/v1/admin/overview")
      .set("authorization", await auth(randomUUID(), ["billing_operator"]))
      .expect(403);
    await h
      .http()
      .get("/v1/admin/overview")
      .set("authorization", await auth(randomUUID(), ["support"]))
      .expect(200);
    await h
      .http()
      .get("/v1/admin/audit")
      .set("authorization", await auth(randomUUID(), ["support"]))
      .expect(403);
  });

  it("summarises deliveries, recipients and channels", async () => {
    const { userId } = await newUser();
    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "service.message",
        category: "service",
        data: { title: "Hi", body: "Body" },
      }),
    );
    await worker.tick();
    const res = await h
      .http()
      .get("/v1/admin/overview")
      .set("authorization", await auth(randomUUID(), ["owner"]))
      .expect(200);
    expect(res.body.last24h.deliveries.email.accepted).toBeGreaterThan(0);
    expect(res.body.recipients.total).toBeGreaterThan(0);
    expect(res.body.channels).toMatchObject({
      email: { provider: "smtp", enabled: true },
      telegram: { configured: true, linkingAvailable: true, enabled: true },
    });
    expect(res.body.daily.length).toBeGreaterThan(0);
  });

  it("retries a failed delivery once, with a reason, and audits it", async () => {
    const { userId, email } = await newUser();
    const owner = await auth(randomUUID(), ["owner"]);
    h.email.fail = new PermanentDeliveryError("smtp 550");
    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "service.message",
        category: "service",
        data: { title: "Retry me", body: "Body" },
      }),
    );
    await worker.tick();
    const [failed] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.userId, userId));
    expect(failed?.state).toBe("failed");

    const list = await h
      .http()
      .get(`/v1/admin/deliveries?userId=${userId}&state=failed`)
      .set("authorization", owner)
      .expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      id: failed?.id,
      title: "Retry me",
      lastError: "smtp 550",
    });

    const retry = `/v1/admin/deliveries/${failed?.id}/retry`;
    await h.http().post(retry).set("authorization", owner).send({}).expect(400);
    h.email.fail = null;
    const res = await h
      .http()
      .post(retry)
      .set("authorization", owner)
      .send({ reason: "SMTP fixed" })
      .expect(200);
    expect(res.body).toMatchObject({ state: "pending", attempts: 0 });
    await worker.tick();
    expect(h.email.sent.some((m) => m.to === email)).toBe(true);
    await h
      .http()
      .post(retry)
      .set("authorization", owner)
      .send({ reason: "again" })
      .expect(409);
    const audit = await db
      .select()
      .from(adminAudit)
      .where(eq(adminAudit.targetId, failed?.id ?? ""));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "delivery.retry",
      reason: "SMTP fixed",
    });
  });

  it("asks for confirmation before retrying an unknown outcome", async () => {
    const { userId } = await newUser();
    const owner = await auth(randomUUID(), ["owner"]);
    h.email.fail = new UnknownOutcomeError("timeout");
    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "service.message",
        category: "service",
        data: { title: "Maybe", body: "Body" },
      }),
    );
    await worker.tick();
    const [row] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.userId, userId));
    expect(row?.state).toBe("unknown");
    const retry = `/v1/admin/deliveries/${row?.id}/retry`;
    await h
      .http()
      .post(retry)
      .set("authorization", owner)
      .send({ reason: "checked" })
      .expect(422);
    await h
      .http()
      .post(retry)
      .set("authorization", owner)
      .send({ reason: "checked", confirmUnknown: true })
      .expect(200);
  });

  it("pauses a channel without losing its deliveries", async () => {
    const { userId, email } = await newUser();
    const owner = await auth(randomUUID(), ["owner"]);
    const current = await h
      .http()
      .get("/v1/admin/settings")
      .set("authorization", owner)
      .expect(200);
    await h
      .http()
      .patch("/v1/admin/settings")
      .set("authorization", await auth(randomUUID(), ["support"]))
      .send({
        expectedVersion: current.body.version,
        channels: { email: { enabled: false } },
        reason: "provider incident",
      })
      .expect(403);
    const paused = await h
      .http()
      .patch("/v1/admin/settings")
      .set("authorization", owner)
      .send({
        expectedVersion: current.body.version,
        channels: { email: { enabled: false } },
        reason: "provider incident",
      })
      .expect(200);
    expect(paused.body.channels.email.enabled).toBe(false);

    await intentsService.accept(
      intentEvent({
        userId,
        templateKey: "service.message",
        category: "service",
        data: { title: "Held", body: "Body" },
      }),
    );
    await worker.tick();
    const [held] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.userId, userId));
    expect(held?.state).toBe("pending");

    await h
      .http()
      .patch("/v1/admin/settings")
      .set("authorization", owner)
      .send({
        expectedVersion: current.body.version,
        channels: { email: { enabled: true } },
        reason: "stale",
      })
      .expect(409);
    await h
      .http()
      .patch("/v1/admin/settings")
      .set("authorization", owner)
      .send({
        expectedVersion: paused.body.version,
        channels: { email: { enabled: true } },
        reason: "provider recovered",
      })
      .expect(200);
    await worker.tick();
    expect(h.email.sent.some((m) => m.to === email)).toBe(true);
  });

  it("previews templates with sample data", async () => {
    const owner = await auth(randomUUID(), ["owner"]);
    const list = await h
      .http()
      .get("/v1/admin/templates")
      .set("authorization", owner)
      .expect(200);
    expect(list.body.items.map((t: { key: string }) => t.key)).toContain(
      "service.test",
    );
    const preview = await h
      .http()
      .get("/v1/admin/templates/auth.login-code/preview?locale=ru")
      .set("authorization", owner)
      .expect(200);
    expect(preview.body.subject).toBe("Код входа: 482913");
    expect(preview.body.html).toContain("482913");
    await h
      .http()
      .get("/v1/admin/templates/nope/preview")
      .set("authorization", owner)
      .expect(404);
    // Every template, in both languages, previews from its own sample.
    for (const { key } of list.body.items as { key: string }[]) {
      for (const locale of ["en", "ru"]) {
        const res = await h
          .http()
          .get(`/v1/admin/templates/${key}/preview?locale=${locale}`)
          .set("authorization", owner)
          .expect(200);
        expect(res.body.subject, `${key} ${locale}`).toBeTruthy();
        expect(res.body.html).toContain(`lang="${locale}"`);
      }
    }
  });

  it("sends a channel check only to the operator's own address", async () => {
    const operator = await newUser();
    const res = await h
      .http()
      .post("/v1/admin/test-message")
      .set("authorization", await auth(operator.userId, ["owner"]))
      .send({ channel: "email" })
      .expect(202);
    expect(res.body.deliveryId).toBeTruthy();
    await worker.tick();
    const sent = h.email.sent.filter((m) => m.to === operator.email);
    expect(sent.at(-1)?.subject).toBe("outegro.dev channel check");
  });

  it("shows a recipient card with a masked email and Telegram state", async () => {
    const { userId, email } = await newUser();
    const res = await h
      .http()
      .get(`/v1/admin/recipients/${userId}`)
      .set("authorization", await auth(randomUUID(), ["support"]))
      .expect(200);
    expect(res.body.email).toBe(maskEmail(email));
    expect(res.body.email).not.toBe(email);
    expect(res.body.telegram).toEqual({ linked: false, linkedAt: null });
    const telegram = await h
      .http()
      .get("/v1/admin/telegram")
      .set("authorization", await auth(randomUUID(), ["support"]))
      .expect(200);
    expect(telegram.body).toMatchObject({
      configured: true,
      username: "outegro_test_bot",
      expectedWebhookUrl: "https://hooks.outegro.test/telegram",
    });
  });

  it("never exposes login codes or other secrets in payloads", () => {
    expect(redact("auth", { code: "123456", minutes: 10 })).toEqual({
      code: "[redacted]",
      minutes: "[redacted]",
    });
    expect(
      redact("security", { ip: "203.0.113.7", reason: "reuse_detected" }),
    ).toEqual({ ip: "[redacted]", reason: "reuse_detected" });
    expect(maskEmail("nick@example.test")).toBe("n***@example.test");
  });
});
