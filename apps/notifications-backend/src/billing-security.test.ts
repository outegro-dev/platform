import { randomUUID } from "node:crypto";
import { DATABASE, HealthRegistry, Messaging } from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NotificationsDatabase } from "./common/database.js";
import { deliveries, inboxItems, intents, recipients } from "./db/schema.js";
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
// ICU puts no-break spaces in amounts and times; compare words.
const plain = (text = "") => text.replace(/\s+/g, " ").trim();
const mailTo = (to: string) => h.email.sent.filter((m) => m.to === to);
const inboxOf = async (userId: string) =>
  (
    await h
      .http()
      .get("/v1/me/inbox")
      .set("authorization", `Bearer ${await h.tokenFor(userId)}`)
      .expect(200)
  ).body.items as { title: string; body: string; category: string }[];

const renewal = (userId: string) =>
  intentEvent({
    producer: "payments",
    userId,
    templateKey: "billing.subscription-renewed.v1",
    category: "billing",
    data: {
      productEn: "Battleship Premium",
      productRu: "Морской бой Premium",
      amountMinor: "5000",
      amountScale: 2,
      currency: "RUB",
      paidAt: "2026-09-29T14:03:00.000Z",
      paidUntil: "2026-10-29T14:03:00.000Z",
      access: "active",
      actionUrl: "https://pay.outegro.dev/subscriptions",
    },
  });
const purchase = (
  userId: string,
  data: Record<string, string | number | boolean | null> = {},
) =>
  intentEvent({
    producer: "payments",
    userId,
    templateKey: "billing.payment-confirmed.v2",
    category: "billing",
    data: {
      productEn: "Silver Fleet",
      productRu: "Серебряный флот",
      amountMinor: "59",
      amountScale: 2,
      currency: "USD",
      paidAt: "2026-09-29T14:03:00.000Z",
      access: "active",
      accessUntil: null,
      actionUrl: `https://pay.outegro.dev/orders/${randomUUID()}`,
      ...data,
    },
  });

describe("billing notices (N-06)", () => {
  it("TC-N-06-01: one renewal reads right in English and in Russian", async () => {
    const en = await newUser("en");
    const ru = await newUser("ru");
    const chatId = String(Date.now());
    await db
      .update(recipients)
      .set({ telegramChatId: chatId, telegramLinkedAt: new Date() })
      .where(eq(recipients.userId, ru.userId));
    await intentsService.accept(renewal(en.userId));
    await intentsService.accept(renewal(ru.userId));
    await worker.tick();

    const [english] = mailTo(en.email);
    expect(english?.subject).toBe("Subscription renewed: Battleship Premium");
    expect(plain(english?.text)).toContain(
      "We received ₽50.00 for “Battleship Premium” on Sep 29, 2026, 2:03 PM UTC. The subscription is now paid until Oct 29, 2026, 2:03 PM UTC. Access is active.",
    );
    expect(english?.html).toContain(
      'href="https://pay.outegro.dev/subscriptions"',
    );

    const [russian] = mailTo(ru.email);
    const text =
      "Оплата 50,00 ₽ за «Морской бой Premium» получена 29 сент. 2026, 14:03 UTC. Теперь подписка оплачена до 29 окт. 2026, 14:03 UTC. Доступ открыт.";
    expect(russian?.subject).toBe("Подписка продлена: Морской бой Premium");
    expect(plain(russian?.text)).toContain(text);
    expect(russian?.html).toContain('lang="ru"');
    const chat = h.telegram.sent.filter((m) => m.chatId === chatId);
    expect(chat.map((m) => plain(m.text))).toEqual([text]);

    expect(await inboxOf(en.userId)).toEqual([
      expect.objectContaining({
        category: "billing",
        title: "Subscription renewed",
      }),
    ]);
    const [item] = await inboxOf(ru.userId);
    expect(item?.title).toBe("Подписка продлена");
    expect(plain(item?.body)).toBe(text);
    const states = await db
      .select({ channel: deliveries.channel, state: deliveries.state })
      .from(deliveries)
      .where(eq(deliveries.userId, ru.userId));
    expect(states.sort((a, b) => a.channel.localeCompare(b.channel))).toEqual([
      { channel: "email", state: "accepted" },
      { channel: "telegram", state: "accepted" },
    ]);
  });

  it("TC-N-06-02: a payment whose grant is not active yet promises no access", async () => {
    const user = await newUser("en");
    await intentsService.accept(purchase(user.userId, { access: "pending" }));
    await worker.tick();
    const [sent] = mailTo(user.email);
    expect(plain(sent?.text)).toContain(
      "We received $0.59 for “Silver Fleet” on Sep 29, 2026, 2:03 PM UTC. Access is not active yet: it opens once activation completes.",
    );
    expect(sent?.text).not.toContain("Access is active");
    const [item] = await inboxOf(user.userId);
    expect(item?.body).not.toContain("Access is active");
  });

  it("TC-N-06-02: a renewal whose access is withheld says it will be refunded, never that access opens", async () => {
    const user = await newUser("ru");
    await intentsService.accept(
      intentEvent({
        producer: "payments",
        userId: user.userId,
        templateKey: "billing.subscription-renewed.v2",
        category: "billing",
        data: {
          productEn: "Battleship Premium",
          productRu: "Морской бой Premium",
          amountMinor: "5000",
          amountScale: 2,
          currency: "RUB",
          paidAt: "2026-09-29T14:03:00.000Z",
          paidUntil: "2026-10-29T14:03:00.000Z",
          access: "withheld",
          actionUrl: "https://pay.outegro.dev/subscriptions",
        },
      }),
    );
    await worker.tick();
    const text =
      "Оплата 50,00 ₽ за «Морской бой Premium» получена 29 сент. 2026, 14:03 UTC. Этот платёж не открывает доступ, мы его вернём.";
    const [sent] = mailTo(user.email);
    expect(sent?.subject).toBe("Оплата получена: Морской бой Premium");
    expect(plain(sent?.text)).toContain(text);
    expect(sent?.text).not.toMatch(/откроется|оплачена до|Доступ открыт/);
    const [item] = await inboxOf(user.userId);
    expect(item).toMatchObject({ title: "Оплата получена" });
    expect(plain(item?.body)).toBe(text);
  });

  it("TC-N-06-02: the refund of a payment that never opened access does not say access ended", async () => {
    const refund = (
      userId: string,
      templateKey: string,
      data: Record<string, string | number | boolean | null> = {},
    ) =>
      intentEvent({
        producer: "payments",
        userId,
        templateKey,
        category: "billing",
        data: {
          productEn: "Silver Fleet",
          productRu: "Серебряный флот",
          amountMinor: "52",
          amountScale: 2,
          currency: "EUR",
          accessUntil: null,
          actionUrl: `https://pay.outegro.dev/orders/${randomUUID()}`,
          ...data,
        },
      });
    const en = await newUser("en");
    const ru = await newUser("ru");
    for (const user of [en, ru])
      expect(
        await intentsService.accept(
          refund(user.userId, "billing.refund-recorded.v2", {
            access: "withheld",
          }),
        ),
      ).toBe("processed");
    await worker.tick();

    const [english] = mailTo(en.email);
    expect(english?.subject).toBe("Refund recorded: Silver Fleet");
    expect(plain(english?.text)).toContain(
      "We recorded a refund of €0.52 for “Silver Fleet”. This payment did not open any access; the money is on its way back.",
    );
    expect(english?.text).not.toContain("has ended");
    const russianText =
      "Мы учли возврат 0,52 € за «Серебряный флот». Этот платёж не открывал никакого доступа, деньги уже возвращаются к вам.";
    expect(plain(mailTo(ru.email)[0]?.text)).toContain(russianText);
    const [item] = await inboxOf(ru.userId);
    expect(item).toMatchObject({ title: "Возврат учтён" });
    expect(plain(item?.body)).toBe(russianText);

    // v1, still in flight from a payments build before v2, is shown as before.
    const earlier = await newUser("en");
    expect(
      await intentsService.accept(
        refund(earlier.userId, "billing.refund-recorded.v1"),
      ),
    ).toBe("processed");
    await worker.tick();
    expect(plain(mailTo(earlier.email)[0]?.text)).toContain(
      "We recorded a refund of €0.52 for “Silver Fleet”. Access from this purchase has ended.",
    );
  });

  it("TC-N-06-03: a name with HTML is sent as text", async () => {
    const user = await newUser("en");
    const hostile = '<img src=x onerror="alert(1)">Fleet';
    await intentsService.accept(purchase(user.userId, { productEn: hostile }));
    await worker.tick();
    const [sent] = mailTo(user.email);
    expect(sent?.subject).toBe(`Payment received: ${hostile}`);
    expect(sent?.html).not.toContain("<img");
    expect(sent?.html).toContain("&lt;img src=x onerror=");
    const [item] = await inboxOf(user.userId);
    // JSON for id-web, which renders it as text.
    expect(item?.body).toContain(hostile);
  });

  it("TC-N-06-03: a link to someone else's site never reaches the user, but the notice does", async () => {
    const user = await newUser("en");
    const dropped = () =>
      h.metric("notifications_action_links_dropped_total", {
        template: "billing.payment-confirmed.v2",
      });
    const droppedBefore = await dropped();
    const hostile = [
      "https://evil.example/orders/1",
      "https://pay.outegro.dev.evil.example/orders/1",
      "https://user:pw@pay.outegro.dev/orders/1",
      "javascript:alert(1)",
    ];
    // A pay-web address payments has but notifications does not (a config
    // mismatch) must not lose the receipt either.
    const events = hostile.map((actionUrl) =>
      purchase(user.userId, { actionUrl }),
    );
    for (const event of events)
      expect(await intentsService.accept(event)).toBe("processed");
    // Redelivered: nothing new is stored or counted.
    const [again] = events;
    if (!again) throw new Error("no event");
    expect(await intentsService.accept(again)).toBe("duplicate");
    await worker.tick();

    const stored = await db
      .select({ data: intents.data })
      .from(intents)
      .where(eq(intents.userId, user.userId));
    expect(stored).toHaveLength(hostile.length);
    for (const { data } of stored) expect(data).not.toHaveProperty("actionUrl");
    const items = await db
      .select({ data: inboxItems.data })
      .from(inboxItems)
      .where(eq(inboxItems.userId, user.userId));
    expect(items).toHaveLength(hostile.length);
    for (const { data } of items) expect(data).not.toHaveProperty("actionUrl");
    const sent = mailTo(user.email);
    expect(sent).toHaveLength(hostile.length);
    for (const mail of sent) {
      expect(mail.subject).toBe("Payment received: Silver Fleet");
      expect(mail.html).not.toMatch(/evil\.example|user:pw|javascript:/);
      expect(mail.text).not.toMatch(/evil\.example|user:pw|javascript:/);
      expect(mail.html).toContain('href="https://pay.outegro.dev/orders"');
    }
    expect(await inboxOf(user.userId)).toHaveLength(hostile.length);
    expect(await dropped()).toBe(droppedBefore + hostile.length);
  });

  it("refuses data a template cannot show exactly", async () => {
    const user = await newUser("en");
    const broken: Record<string, string>[] = [
      { amountMinor: "0.59" },
      { currency: "rub" },
      { paidAt: "yesterday" },
      { access: "maybe" },
    ];
    for (const data of broken) {
      await expect(
        intentsService.accept(purchase(user.userId, data)),
      ).rejects.toThrow("invalid data for billing.payment-confirmed.v2");
    }
    expect(
      await db.select().from(intents).where(eq(intents.userId, user.userId)),
    ).toHaveLength(0);
  });

  it("keeps rendering payment messages stored in the v1 shape, without claiming access", async () => {
    const user = await newUser("ru");
    await intentsService.accept(
      intentEvent({
        producer: "payments",
        userId: user.userId,
        templateKey: "billing.payment-confirmed",
        category: "billing",
        data: { product: "Серебряный флот", amount: "0.59 USD" },
      }),
    );
    const [item] = await inboxOf(user.userId);
    expect(item).toMatchObject({
      title: "Оплата получена",
      body: "Мы получили оплату 0.59 USD за «Серебряный флот».",
    });
  });
});

describe("passkey notices (ID-05)", () => {
  it("an added and a removed passkey are told in the reader's language, by email and inbox, without the passkey's name", async () => {
    const en = await newUser("en");
    const ru = await newUser("ru");
    const passkeyId = randomUUID();
    for (const user of [en, ru])
      for (const templateKey of [
        "security.passkey-added.v1",
        "security.passkey-removed.v1",
      ])
        await intentsService.accept(
          intentEvent({
            userId: user.userId,
            templateKey,
            category: "security",
            sourceEventId: passkeyId,
            // More than the template shows: a name typed by whoever held
            // the session never reaches the message or its storage.
            data: {
              at: "2026-09-29T14:03:00.000Z",
              name: "Call +1 555 0100 to keep your account",
            },
          }),
        );
    await worker.tick();

    const byPlainSubject = (to: string) =>
      Object.fromEntries(
        mailTo(to).map((m) => [plain(m.subject), plain(m.text)]),
      );
    expect(byPlainSubject(en.email)).toEqual({
      "A passkey was added to your account": expect.stringContaining(
        "A passkey was added to your outegro.dev account on Sep 29, 2026, 2:03 PM UTC and can now be used to sign in. If this was not you, remove it under Security and end your other sessions.",
      ),
      "A passkey was removed from your account": expect.stringContaining(
        "A passkey was removed from your outegro.dev account on Sep 29, 2026, 2:03 PM UTC and can no longer be used to sign in. If this was not you, sign in with an email code and review your sign-in methods and sessions.",
      ),
    });
    expect(byPlainSubject(ru.email)).toEqual({
      "К аккаунту добавлен ключ доступа": expect.stringContaining(
        "К вашему аккаунту outegro.dev добавлен ключ доступа (29 сент. 2026, 14:03 UTC), теперь с ним можно входить. Если это были не вы, удалите его в разделе «Безопасность» и завершите остальные сеансы.",
      ),
      "Ключ доступа удалён из аккаунта": expect.stringContaining(
        "Из вашего аккаунта outegro.dev удалён ключ доступа (29 сент. 2026, 14:03 UTC), входить с ним больше нельзя. Если это были не вы, войдите по коду из письма и проверьте способы входа и сеансы.",
      ),
    });
    for (const mail of [...mailTo(en.email), ...mailTo(ru.email)]) {
      expect(mail.html).toContain(
        'href="https://id.outegro.dev/account/security"',
      );
      expect(mail.html).not.toContain("555");
      expect(mail.text).not.toContain("555");
    }
    expect((await inboxOf(ru.userId)).map((item) => item.title).sort()).toEqual(
      ["Добавлен ключ доступа", "Ключ доступа удалён"],
    );
    const stored = await db
      .select({ data: intents.data })
      .from(intents)
      .where(eq(intents.userId, en.userId));
    expect(stored.map((row) => row.data)).toEqual([
      { at: "2026-09-29T14:03:00.000Z" },
      { at: "2026-09-29T14:03:00.000Z" },
    ]);

    // One notice per passkey and template: the same source again is ignored.
    await intentsService.accept(
      intentEvent({
        userId: en.userId,
        templateKey: "security.passkey-added.v1",
        category: "security",
        sourceEventId: passkeyId,
        data: { at: "2026-09-29T14:03:00.000Z" },
      }),
    );
    await worker.tick();
    expect(mailTo(en.email)).toHaveLength(2);
  });
});

describe("support removes a passkey; a sign-in no email preceded", () => {
  it("a passkey removed by support is told on its own, with the time only", async () => {
    const en = await newUser("en");
    const ru = await newUser("ru");
    for (const user of [en, ru])
      await intentsService.accept(
        intentEvent({
          userId: user.userId,
          templateKey: "security.passkey-revoked.v1",
          category: "security",
          sourceEventId: randomUUID(),
          // The operator's reason stays in Identity's audit log.
          data: { at: "2026-09-29T14:03:00.000Z", reason: "ticket 4521" },
        }),
      );
    await worker.tick();
    const [mailEn] = mailTo(en.email);
    expect(plain(mailEn?.subject ?? "")).toBe(
      "Support removed a passkey from your account",
    );
    expect(plain(mailEn?.text ?? "")).toContain(
      "Support removed a passkey from your outegro.dev account on Sep 29, 2026, 2:03 PM UTC, and it can no longer be used to sign in. This is done when a device is lost. If you did not ask for it, sign in with an email code and review your sign-in methods and sessions.",
    );
    expect(mailEn?.html).toContain(
      'href="https://id.outegro.dev/account/security"',
    );
    const [mailRu] = mailTo(ru.email);
    expect(plain(mailRu?.subject ?? "")).toBe(
      "Поддержка удалила ключ доступа из аккаунта",
    );
    expect(plain(mailRu?.text ?? "")).toContain(
      "Поддержка удалила ключ доступа из вашего аккаунта outegro.dev (29 сент. 2026, 14:03 UTC), входить с ним больше нельзя.",
    );
    for (const mail of [mailEn, mailRu])
      expect(mail?.text).not.toContain("4521");
    const stored = await db
      .select({ data: intents.data })
      .from(intents)
      .where(eq(intents.userId, en.userId));
    expect(stored.map((row) => row.data)).toEqual([
      { at: "2026-09-29T14:03:00.000Z" },
    ]);
  });

  it("a passkey or Google sign-in names the method, a browser and a system from the list, and the time", async () => {
    const en = await newUser("en");
    const ru = await newUser("ru");
    const signIn = (userId: string, data: Record<string, string | null>) =>
      intentsService.accept(
        intentEvent({
          userId,
          templateKey: "security.sign-in.v1",
          category: "security",
          sourceEventId: randomUUID(),
          data: { at: "2026-09-29T14:03:00.000Z", ...data },
        }),
      );
    await signIn(en.userId, {
      method: "passkey",
      browser: "Chrome",
      os: "Windows",
    });
    await signIn(en.userId, { method: "google", browser: null, os: null });
    await signIn(ru.userId, { method: "google", browser: "Safari", os: "iOS" });
    await signIn(ru.userId, {
      method: "passkey",
      browser: null,
      os: "Android",
    });
    await worker.tick();

    const texts = (to: string) =>
      mailTo(to)
        .map((m) => [plain(m.subject), plain(m.text)] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    const en_ = texts(en.email);
    expect(en_.map(([subject]) => subject)).toEqual([
      "New sign-in to your account with a passkey",
      "New sign-in to your account with Google",
    ]);
    expect(en_[0]?.[1]).toContain(
      "New sign-in to your outegro.dev account: with a passkey, from Chrome on Windows, Sep 29, 2026, 2:03 PM UTC. If this was not you, end that session under Sessions and review your sign-in methods.",
    );
    expect(en_[1]?.[1]).toContain(
      "New sign-in to your outegro.dev account: with Google, Sep 29, 2026, 2:03 PM UTC.",
    );
    const ru_ = texts(ru.email);
    const ruTexts = ru_.map(([, text]) => text).join(" | ");
    expect(ruTexts).toContain(
      "Новый вход в ваш аккаунт outegro.dev: через Google, Safari на iOS, 29 сент. 2026, 14:03 UTC.",
    );
    expect(ruTexts).toContain(
      "Новый вход в ваш аккаунт outegro.dev: по ключу доступа, Android, 29 сент. 2026, 14:03 UTC. Если это были не вы, завершите этот сеанс в разделе «Сеансы» и проверьте способы входа.",
    );
    for (const mail of [...mailTo(en.email), ...mailTo(ru.email)])
      expect(mail.html).toContain(
        'href="https://id.outegro.dev/account/sessions"',
      );
  });

  it("refuses a browser or a system that is not on the list: the header never reaches a message", async () => {
    const user = await newUser("en");
    for (const data of [
      { method: "passkey", browser: "<b>Evil</b>", os: null },
      { method: "passkey", browser: null, os: "Windows 95; DROP TABLE" },
      { method: "email", browser: null, os: null },
    ])
      await expect(
        intentsService.accept(
          intentEvent({
            userId: user.userId,
            templateKey: "security.sign-in.v1",
            category: "security",
            sourceEventId: randomUUID(),
            data: { at: "2026-09-29T14:03:00.000Z", ...data },
          }),
        ),
      ).rejects.toThrow("invalid data for security.sign-in.v1");
    expect(
      await db.select().from(intents).where(eq(intents.userId, user.userId)),
    ).toHaveLength(0);
  });
});

describe("consumer path (N-06)", () => {
  it("a billing notice from payments and a security notice from identity arrive over RabbitMQ", async () => {
    const payments = new Messaging(
      { url: h.rabbitUrl, service: "payments" },
      new HealthRegistry(),
    );
    const identity = new Messaging(
      { url: h.rabbitUrl, service: "identity" },
      new HealthRegistry(),
    );
    const user = await newUser("en");
    const billing = purchase(user.userId);
    await payments.publish("payments.events", billing);
    await identity.publish(
      "identity.events",
      intentEvent({
        userId: user.userId,
        templateKey: "security.google-linked.v1",
        category: "security",
        data: { at: "2026-09-29T14:03:00.000Z" },
      }),
    );
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && mailTo(user.email).length < 2) {
      await worker.tick();
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(mailTo(user.email).map((m) => m.subject)).toEqual(
      expect.arrayContaining([
        "Payment received: Silver Fleet",
        "Google sign-in was added to your account",
      ]),
    );
    const google = mailTo(user.email).find((m) => m.subject.includes("Google"));
    expect(google?.html).toContain(
      'href="https://id.outegro.dev/account/security"',
    );
    const stored = await db
      .select({ producer: intents.producer, key: intents.templateKey })
      .from(intents)
      .where(eq(intents.userId, user.userId));
    expect(stored).toEqual(
      expect.arrayContaining([
        { producer: "payments", key: "billing.payment-confirmed.v2" },
        { producer: "identity", key: "security.google-linked.v1" },
      ]),
    );
    // The same event again is acknowledged without a second message.
    await payments.publish("payments.events", billing);
    await new Promise((r) => setTimeout(r, 1000));
    await worker.tick();
    expect(mailTo(user.email)).toHaveLength(2);
    await payments.onApplicationShutdown();
    await identity.onApplicationShutdown();
  });
});
