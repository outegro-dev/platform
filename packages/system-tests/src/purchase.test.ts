import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeInvoice } from "./fake-lava.js";
import { type Stack, startStack } from "./stack.js";

/*
 * R-02: one purchase through the whole platform, as processes talk in
 * production (HTTP, RabbitMQ, SMTP), and the same purchase while the broker
 * or the mail server is down. Lava is the only fake.
 */

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
});
afterAll(async () => {
  await stack?.stop();
});

const email = () => `sys-${randomBytes(5).toString("hex")}@outegro.test`;
const ip = () =>
  `198.18.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

type Mail = { ID: string; Subject: string; Created: string };
async function mailTo(address: string): Promise<Mail[]> {
  const res = await fetch(
    `${stack.mailHttp}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}&limit=50`,
  );
  return ((await res.json()) as { messages: Mail[] }).messages ?? [];
}

/** Polls until `check` returns a value (not undefined/false), or fails. */
async function eventually<T>(
  what: string,
  check: () => Promise<T | undefined | false>,
  timeoutMs = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value !== undefined && value !== false) return value as T;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last}` : ""}`);
}

async function api<T>(
  service: "auth" | "payments" | "battleship" | "notifications",
  path: string,
  init: {
    method?: string;
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${stack.url(service)}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

/** Email-code sign-in: the code travels Identity → Notifications → SMTP. */
async function signIn(address: string) {
  const from = { "x-forwarded-for": ip() };
  const since = Date.now() - 2000;
  const challenge = await api<{ challengeId: string }>(
    "auth",
    "/v1/login/challenges",
    {
      method: "POST",
      headers: from,
      body: { email: address, locale: "en" },
    },
  );
  expect(challenge.status, JSON.stringify(challenge.body)).toBe(201);
  const code = await eventually("the sign-in code email", async () => {
    const latest = (await mailTo(address))[0];
    const match = latest?.Subject.match(/\d{6}/)?.[0];
    return match && Date.parse(latest.Created) >= since ? match : undefined;
  });
  const verified = await api<{
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  }>("auth", "/v1/login/challenges/verify", {
    method: "POST",
    headers: from,
    body: { challengeId: challenge.body.challengeId, code },
  });
  expect(verified.status).toBe(200);
  return verified.body;
}

type Checkout = { orderId: string; paymentUrl?: string; status: string };
async function buy(token: string, productKey: string) {
  const res = await api<Checkout>("payments", "/v1/checkout", {
    method: "POST",
    token,
    headers: { "idempotency-key": randomUUID() },
    body: { productKey, currency: "USD" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const invoice = stack.lava.invoices.at(-1) as FakeInvoice;
  expect(res.body.paymentUrl).toBe(
    `https://app.lava.top/payment/${invoice.id}`,
  );
  return { orderId: res.body.orderId, invoice };
}

const webhook = (body: unknown) =>
  fetch(`${stack.url("payments")}/webhooks/lava`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": stack.secrets.LAVA_WEBHOOK_SECRET,
    },
    body: JSON.stringify(body),
  });

type Order = { status: string };
const orderOf = (token: string, id: string) =>
  api<Order>("payments", `/v1/me/orders/${id}`, { token }).then((r) => r.body);
const premiumOf = (token: string) =>
  api<{ premium: boolean }>("battleship", "/v1/me", { token }).then(
    (r) => r.body.premium,
  );
const billingMail = async (address: string) =>
  (await mailTo(address)).filter((m) => !/\d{6}/.test(m.Subject));

describe("TC-R-02-01: checkout → payment → access → notice → admin", () => {
  it("links every id and has one effect, even when Lava repeats itself", async () => {
    const buyer = await signIn(email());
    const address = (
      await api<{ email: string }>("auth", "/v1/me", {
        token: buyer.accessToken,
      })
    ).body.email;
    expect(await premiumOf(buyer.accessToken)).toBe(false);

    const { orderId, invoice } = await buy(
      buyer.accessToken,
      "battleship-premium",
    );
    expect((await orderOf(buyer.accessToken, orderId)).status).not.toBe("paid");

    const paid = stack.lava.paymentSuccess(invoice);
    expect((await webhook(paid)).status).toBe(200);
    await eventually(
      "the order to be paid",
      async () => (await orderOf(buyer.accessToken, orderId)).status === "paid",
    );
    await eventually("Premium in Battleship", () =>
      premiumOf(buyer.accessToken),
    );
    const [notice] = await eventually("the payment email", async () => {
      const mails = await billingMail(address);
      return mails.length > 0 ? mails : undefined;
    });
    expect(notice?.Subject).toBeTruthy();

    // Lava delivers the same webhook again: nothing new happens.
    expect((await webhook(paid)).status).toBe(200);

    // The operator sees one chain: order → Lava invoice → payment → grant.
    const operator = email();
    const session = await signIn(operator);
    await stack.grantOwner(operator);
    // Roles go into the next access token: refresh instead of a second code.
    const owner = (
      await api<{ accessToken: string }>("auth", "/v1/sessions/refresh", {
        method: "POST",
        body: { refreshToken: session.refreshToken },
      })
    ).body;
    const detail = await eventually("the order in the admin API", async () => {
      const res = await api<{
        order: { id: string; userId: string };
        attempt: { providerInvoiceId: string };
        payments: { id: string; providerContractId?: string }[];
        grants: {
          id: string;
          state: string;
          service: string;
          feature: string;
        }[];
        events: { id: string }[];
      }>("payments", `/v1/admin/orders/${orderId}`, {
        token: owner.accessToken,
      });
      return res.status === 200 ? res.body : undefined;
    });
    expect(detail.order).toMatchObject({ id: orderId, userId: buyer.user.id });
    expect(detail.attempt.providerInvoiceId).toBe(invoice.id);
    expect(detail.payments).toHaveLength(1);
    expect(detail.grants).toEqual([
      expect.objectContaining({
        state: "active",
        service: "battleship",
        feature: "premium",
      }),
    ]);
    // The repeated webhook is the same provider event, stored once.
    expect(detail.events).toHaveLength(1);

    // One email for the purchase, after the replay settled too.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(await billingMail(address)).toHaveLength(1);
    const grantId = detail.grants[0]?.id;
    expect(
      await stack.query(
        "battleship",
        `select count(*) from grants where grant_id = '${grantId}'`,
      ),
    ).toBe("1");
  });
});

describe("TC-R-02-02: the broker or the mail server is down", () => {
  it("broker down: the payment and the grant are kept, access and the email follow once it is back", async () => {
    const buyer = await signIn(email());
    const address = (
      await api<{ email: string }>("auth", "/v1/me", {
        token: buyer.accessToken,
      })
    ).body.email;
    const { orderId, invoice } = await buy(
      buyer.accessToken,
      "battleship-premium",
    );

    await stack.broker.down();
    try {
      expect((await webhook(stack.lava.paymentSuccess(invoice))).status).toBe(
        200,
      );
      await eventually(
        "the order to be paid without the broker",
        async () =>
          (await orderOf(buyer.accessToken, orderId)).status === "paid",
      );
      // Money and the grant are in Payments; nobody else has heard yet.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      expect(await premiumOf(buyer.accessToken)).toBe(false);
      expect(await billingMail(address)).toHaveLength(0);
      expect(
        Number(
          await stack.query(
            "payments",
            "select count(*) from outbox where status = 'pending'",
          ),
        ),
      ).toBeGreaterThan(0);
    } finally {
      await stack.broker.up();
    }
    await eventually(
      "Premium after the broker is back",
      () => premiumOf(buyer.accessToken),
      120_000,
    );
    await eventually(
      "the payment email after the broker is back",
      async () => (await billingMail(address)).length === 1,
      120_000,
    );
  });

  it("mail server down: the email waits and is delivered once, when it is back", async () => {
    const buyer = await signIn(email());
    const address = (
      await api<{ email: string }>("auth", "/v1/me", {
        token: buyer.accessToken,
      })
    ).body.email;
    const { orderId, invoice } = await buy(
      buyer.accessToken,
      "battleship-premium",
    );

    await stack.smtp.down();
    try {
      expect((await webhook(stack.lava.paymentSuccess(invoice))).status).toBe(
        200,
      );
      await eventually(
        "the order to be paid",
        async () =>
          (await orderOf(buyer.accessToken, orderId)).status === "paid",
      );
      await eventually("Premium without email", () =>
        premiumOf(buyer.accessToken),
      );
      // The delivery failed and waits for its next attempt.
      await eventually(
        "a delivery waiting to retry",
        async () =>
          Number(
            await stack.query(
              "notifications",
              "select count(*) from deliveries where channel = 'email' and state = 'retry_wait'",
            ),
          ) > 0,
      );
    } finally {
      await stack.smtp.up();
    }
    await eventually(
      "the payment email after SMTP is back",
      async () => (await billingMail(address)).length === 1,
      120_000,
    );
  });
});

describe("OPS-07 TC-OPS-07-03: SAFE_MODE after a restore", () => {
  it("restarted with SAFE_MODE, services answer HTTP but act on nothing; without it, what waited runs once", async () => {
    // Signed in before: in safe mode Notifications sends no sign-in codes.
    const buyer = await signIn(email());
    const address = (
      await api<{ email: string }>("auth", "/v1/me", {
        token: buyer.accessToken,
      })
    ).body.email;
    const { orderId, invoice } = await buy(
      buyer.accessToken,
      "battleship-premium",
    );

    await stack.restart("payments", { SAFE_MODE: "true" });
    await stack.restart("notifications", { SAFE_MODE: "true" });
    try {
      // HTTP works: Lava's webhook is stored and the order is paid...
      expect((await webhook(stack.lava.paymentSuccess(invoice))).status).toBe(
        200,
      );
      await eventually(
        "the order to be paid in safe mode",
        async () =>
          (await orderOf(buyer.accessToken, orderId)).status === "paid",
      );
      // ...but nothing leaves Payments: no access, no email, events wait.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      expect(await premiumOf(buyer.accessToken)).toBe(false);
      expect(await billingMail(address)).toHaveLength(0);
      expect(
        Number(
          await stack.query(
            "payments",
            "select count(*) from outbox where status = 'pending'",
          ),
        ),
      ).toBeGreaterThan(0);
      const health = await fetch(`${stack.url("payments")}/health`).then(
        (res) => res.status,
      );
      expect(health).toBe(200);
    } finally {
      await stack.restart("payments");
      await stack.restart("notifications");
    }
    await eventually(
      "Premium once safe mode is off",
      () => premiumOf(buyer.accessToken),
      120_000,
    );
    await eventually(
      "one payment email once safe mode is off",
      async () => (await billingMail(address)).length === 1,
      120_000,
    );
  });
});

describe("OPS-07 TC-OPS-07-02: a payment the restored database never saw", () => {
  it("reconciliation finds it at Lava and settles it once; the late webhook changes nothing", async () => {
    const buyer = await signIn(email());
    const address = (
      await api<{ email: string }>("auth", "/v1/me", {
        token: buyer.accessToken,
      })
    ).body.email;
    const { orderId, invoice } = await buy(
      buyer.accessToken,
      "battleship-premium",
    );
    // Paid at Lava, but the webhook went to a database that no longer
    // exists (restored to an earlier point): only reconciliation can know.
    invoice.status = "COMPLETED";
    await eventually(
      "reconciliation to settle the order",
      async () => (await orderOf(buyer.accessToken, orderId)).status === "paid",
      150_000,
    );
    await eventually(
      "Premium after reconciliation",
      () => premiumOf(buyer.accessToken),
      60_000,
    );
    await eventually(
      "one payment email",
      async () => (await billingMail(address)).length === 1,
    );

    expect((await webhook(stack.lava.paymentSuccess(invoice))).status).toBe(
      200,
    );
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect(await billingMail(address)).toHaveLength(1);
    expect(
      await stack.query(
        "payments",
        `select count(*) from payments where order_id = '${orderId}'`,
      ),
    ).toBe("1");
  });
});
