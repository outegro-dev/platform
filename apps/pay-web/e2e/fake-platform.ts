/**
 * Hermetic stand-in for the platform services pay-web talks to, for e2e
 * only. One Node process plays two services:
 *
 * - Identity (auth-backend + id.outegro.dev): GET /authorize auto-approves
 *   the persona named by the `fake_persona` cookie and redirects back with a
 *   code; POST /v1/oauth/token checks PKCE and issues tokens;
 *   /v1/sessions/refresh rotates; /v1/sessions/logout revokes; GET /v1/me.
 * - Payments (payments-backend, feat/payments fd73609 shapes): catalog,
 *   checkout with Idempotency-Key, orders, subscriptions, cancel.
 *
 * Tests shape the world through /__control: personas with realistic data,
 * an outage switch per persona, and order settlement (paid, failed, access
 * lag) at a chosen moment. Personas are isolated, so tests run in
 * parallel. Run: node e2e/fake-platform.ts (Node type stripping).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const PORT = Number(process.env.FAKE_PLATFORM_PORT ?? 4197);
const APP_ORIGIN = process.env.FAKE_APP_ORIGIN ?? "http://localhost:3197";
const LAVA_ORIGIN = "https://app.lava.top";
const DAY = 86_400_000;
const MINUTE = 60_000;

type Currency = "RUB" | "USD" | "EUR";
type Money = { minor: string; currency: Currency; scale: number };
type Localized = { en: string; ru: string };

type Product = {
  key: string;
  service: string;
  feature: string;
  kind: "subscription" | "one_time";
  /** WEEKLY: a period pay-web has no words for (catalog "future"). */
  periodicity: "MONTHLY" | "ONE_TIME" | "WEEKLY";
  graceDays: number;
  title: Localized;
  description: Localized;
  prices: Record<Currency, string>;
};

// The real catalog (payments-backend src/domain/catalog.ts).
const products: Product[] = [
  {
    key: "battleship-premium",
    service: "battleship",
    feature: "premium",
    kind: "subscription",
    periodicity: "MONTHLY",
    graceDays: 3,
    title: { en: "Battleship Premium", ru: "Морской бой Premium" },
    description: {
      en: "Hard and expert bots, extended statistics, every skin and a leaderboard badge while the subscription lasts.",
      ru: "Сложный бот и эксперт, расширенная статистика, все скины и значок в лидерборде на время подписки.",
    },
    prices: { EUR: "52", RUB: "5000", USD: "59" },
  },
  {
    key: "battleship-silver-fleet",
    service: "battleship",
    feature: "cosmetics.silver-fleet",
    kind: "one_time",
    periodicity: "ONE_TIME",
    graceDays: 0,
    title: { en: "Silver Fleet", ru: "Серебряный флот" },
    description: {
      en: "Silver ships, the “shards” hit effect and the “Night sea” board theme, forever.",
      ru: "Серебряные корабли, эффект попадания «осколки» и тема поля «Ночное море», навсегда.",
    },
    prices: { EUR: "52", RUB: "5000", USD: "59" },
  },
];
/**
 * Catalog "future": products of apps pay-web knows less about, listed after
 * the real ones. Education is named and linked but sells with a period this
 * build has no words for; the assistant has neither a name nor a link here.
 * Shown only: checkout does not know them.
 */
const futureProducts: Product[] = [
  {
    key: "edu-all-books",
    service: "edu",
    feature: "books.all",
    kind: "subscription",
    periodicity: "WEEKLY",
    graceDays: 0,
    title: { en: "All textbooks", ru: "Все учебники" },
    description: {
      en: "Every textbook with its exercises and flash cards.",
      ru: "Все учебники с упражнениями и карточками.",
    },
    prices: { EUR: "52", RUB: "5000", USD: "59" },
  },
  {
    key: "assistant-pro",
    service: "assistant",
    feature: "pro",
    kind: "one_time",
    periodicity: "ONE_TIME",
    graceDays: 0,
    title: { en: "Assistant Pro", ru: "Assistant Pro" },
    description: {
      en: "A product of an app pay-web has no name for.",
      ru: "Продукт приложения, которого pay-web не знает.",
    },
    prices: { EUR: "52", RUB: "5000", USD: "59" },
  },
];
const priceIds = new Map(
  [...products, ...futureProducts].flatMap((p) =>
    (Object.keys(p.prices) as Currency[]).map((c) => [
      `${p.key}:${c}`,
      randomUUID(),
    ]),
  ),
);

type Grant = {
  id: string;
  service: string;
  feature: string;
  sourceType: "purchase" | "subscription";
  sourceId: string;
  state: "active" | "revoked" | "expired";
  validFrom: number;
  validUntil: number | null;
};

type OrderRecord = {
  id: string;
  userId: string;
  product: Product;
  currency: Currency;
  status: "pending" | "paid" | "failed" | "refunded";
  createdAt: number;
  paidAt: number | null;
  checkout: {
    state: "requesting" | "ready" | "failed" | "unknown";
    invoiceId: string | null;
    returnUrl: string;
  } | null;
  subscriptionId: string | null;
  grant: Grant | null;
  settle: {
    outcome: "paid" | "failed" | "refunded";
    at: number;
    accessAt: number | null;
  } | null;
};

type SubscriptionRecord = {
  id: string;
  userId: string;
  orderId: string;
  product: Product;
  currency: Currency;
  state:
    | "pending"
    | "active"
    | "past_due"
    | "cancel_requested"
    | "cancelling"
    | "expired"
    | "suspended";
  autoRenew: boolean;
  paidUntil: number;
  cancelRequestedAt: number | null;
  cancelledAt: number | null;
  expiredAt: number | null;
  createdAt: number;
};

type Persona = {
  id: string;
  email: string;
  displayName: string | null;
  /** Platform roles Identity reports (the account menu's admin link). */
  roles: string[];
  /** Identity's /v1/me answers (up) or fails (down); sessions still work. */
  identity: "up" | "down";
  locale: "en" | "ru";
  createdAt: number;
  ip: string | null;
  payments: "up" | "down";
  catalog: "normal" | "empty" | "closed" | "down" | "future";
  cancelMode: "confirm" | "pending";
  checkoutMode: "ready" | "preparing" | "failed" | "offsite";
  accessTtlSec: number;
  /** Delay of every payments answer, to see loading states. */
  latencyMs: number;
  log: {
    refreshes: number;
    logouts: number;
    checkouts: {
      key: string;
      productKey: string;
      currency: string;
      returnUrl: string | null;
    }[];
    cancels: string[];
    orderPolls: number;
  };
};

type Session = { personaId: string; refreshToken: string; revoked: boolean };

const personas = new Map<string, Persona>();
const orders = new Map<string, OrderRecord>();
const subscriptions = new Map<string, SubscriptionRecord>();
const codes = new Map<
  string,
  { personaId: string; challenge: string; redirectUri: string }
>();
const sessions = new Map<string, Session>();
const refreshIndex = new Map<string, string>();
const checkoutKeys = new Map<
  string,
  { fingerprint: string; orderId: string }
>();

// ─── helpers ─────────────────────────────────────────────────────────────

const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString();

const money = (product: Product, currency: Currency): Money => ({
  minor: product.prices[currency],
  currency,
  scale: 2,
});

function addMonth(ms: number) {
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.getTime();
}

const productByKey = (key: string) => products.find((p) => p.key === key);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function send(
  res: ServerResponse,
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function error(
  res: ServerResponse,
  status: number,
  code: string,
  fieldErrors: Record<string, string[]> = {},
) {
  send(res, status, {
    error: {
      code,
      messageKey: `errors.${code.toLowerCase()}`,
      fieldErrors,
      requestId: `fake-${randomBytes(4).toString("hex")}`,
      retryable: status >= 500,
    },
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return Symbol.for("invalid-json");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function cookie(req: IncomingMessage, name: string) {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

const base64url = (value: string | Buffer) =>
  Buffer.from(value).toString("base64url");

function issueTokens(personaId: string) {
  const persona = personas.get(personaId);
  const sessionId = randomUUID();
  const refreshToken = randomBytes(48).toString("base64url");
  sessions.set(sessionId, { personaId, refreshToken, revoked: false });
  refreshIndex.set(refreshToken, sessionId);
  return tokensFor(sessionId, persona?.accessTtlSec ?? 900);
}

function tokensFor(sessionId: string, ttlSec: number) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("no session");
  const now = Date.now();
  const exp = Math.floor(now / 1000) + ttlSec;
  const accessToken = [
    base64url(JSON.stringify({ alg: "none", typ: "JWT" })),
    base64url(JSON.stringify({ sub: session.personaId, sid: sessionId, exp })),
    base64url(randomBytes(16)),
  ].join(".");
  return {
    sessionId,
    accessToken,
    accessTokenExpiresAt: new Date(exp * 1000).toISOString(),
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: new Date(now + 30 * DAY).toISOString(),
  };
}

/** The persona behind a Bearer token, if its session is alive and not expired. */
function personaFromToken(req: IncomingMessage): Persona | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as {
      sub?: string;
      sid?: string;
      exp?: number;
    };
    const session = claims.sid ? sessions.get(claims.sid) : undefined;
    if (!session || session.revoked || session.personaId !== claims.sub)
      return null;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return personas.get(session.personaId) ?? null;
  } catch {
    return null;
  }
}

/** The persona a public request belongs to, by the client IP pay-web forwards. */
function personaFromIp(req: IncomingMessage): Persona | null {
  const ip = String(req.headers["x-forwarded-for"] ?? "")
    .split(",")
    .at(-1)
    ?.trim();
  if (!ip) return null;
  for (const persona of personas.values())
    if (persona.ip === ip) return persona;
  return null;
}

// ─── payments views (exact backend shapes) ───────────────────────────────

/** Applies a scheduled settlement once its moment has come. */
function advance(order: OrderRecord) {
  const now = Date.now();
  const settle = order.settle;
  if (!settle) return;
  if (settle.at <= now && order.status === "pending") {
    if (settle.outcome === "failed") {
      order.status = "failed";
      order.settle = null;
      return;
    }
    order.status = "paid";
    order.paidAt = settle.at;
    if (order.product.kind === "subscription") {
      const sub: SubscriptionRecord = {
        id: randomUUID(),
        userId: order.userId,
        orderId: order.id,
        product: order.product,
        currency: order.currency,
        state: "active",
        autoRenew: true,
        paidUntil: addMonth(settle.at),
        cancelRequestedAt: null,
        cancelledAt: null,
        expiredAt: null,
        createdAt: settle.at,
      };
      subscriptions.set(sub.id, sub);
      order.subscriptionId = sub.id;
    }
  }
  if (order.status === "paid" && !order.grant) {
    const accessAt = settle.accessAt ?? settle.at;
    if (accessAt <= now) {
      order.grant = grantFor(order, accessAt);
      order.settle = null;
    }
  }
}

function grantFor(order: OrderRecord, from: number): Grant {
  const sub = order.subscriptionId
    ? subscriptions.get(order.subscriptionId)
    : undefined;
  return {
    id: randomUUID(),
    service: order.product.service,
    feature: order.product.feature,
    sourceType: sub ? "subscription" : "purchase",
    sourceId: sub ? sub.id : order.id,
    state: "active",
    validFrom: from,
    validUntil: sub ? sub.paidUntil + order.product.graceDays * DAY : null,
  };
}

function orderView(order: OrderRecord) {
  advance(order);
  return {
    id: order.id,
    productKey: order.product.key,
    title: order.product.title,
    kind: order.product.kind,
    status: order.status,
    money: money(order.product, order.currency),
    priceVersion: 1,
    createdAt: iso(order.createdAt),
    paidAt: iso(order.paidAt),
    checkout: order.checkout
      ? {
          state: order.checkout.state,
          paymentUrl:
            order.checkout.state === "ready" &&
            order.status === "pending" &&
            order.checkout.invoiceId
              ? paymentUrlFor(order)
              : null,
        }
      : null,
    subscriptionId: order.subscriptionId,
    access: order.grant
      ? {
          id: order.grant.id,
          userId: order.userId,
          service: order.grant.service,
          feature: order.grant.feature,
          sourceType: order.grant.sourceType,
          sourceId: order.grant.sourceId,
          state: order.grant.state,
          validFrom: iso(order.grant.validFrom),
          validUntil: iso(order.grant.validUntil),
          version: 1,
        }
      : null,
  };
}

function paymentUrlFor(order: OrderRecord) {
  const persona = personas.get(order.userId);
  const origin =
    persona?.checkoutMode === "offsite"
      ? "https://pay.example.test"
      : LAVA_ORIGIN;
  return `${origin}/pay/${order.checkout?.invoiceId}`;
}

function subscriptionView(sub: SubscriptionRecord) {
  return {
    id: sub.id,
    orderId: sub.orderId,
    productKey: sub.product.key,
    title: sub.product.title,
    state: sub.state,
    autoRenew: sub.autoRenew,
    paidUntil: iso(sub.paidUntil),
    accessUntil: iso(sub.paidUntil + sub.product.graceDays * DAY),
    money: money(sub.product, sub.currency),
    periodicity: sub.product.periodicity,
    cancelRequestedAt: iso(sub.cancelRequestedAt),
    cancelledAt: iso(sub.cancelledAt),
    expiredAt: iso(sub.expiredAt),
    createdAt: iso(sub.createdAt),
  };
}

function catalogView(persona: Persona | null) {
  const mode = persona?.catalog ?? "normal";
  const listed =
    mode === "empty"
      ? []
      : mode === "future"
        ? [...products, ...futureProducts]
        : products;
  return {
    checkoutEnabled: mode !== "closed",
    products: listed.map((p) => ({
      key: p.key,
      service: p.service,
      feature: p.feature,
      kind: p.kind,
      periodicity: p.periodicity,
      graceDays: p.graceDays,
      title: p.title,
      description: p.description,
      prices: (["EUR", "RUB", "USD"] as Currency[]).map((currency) => ({
        priceId: priceIds.get(`${p.key}:${currency}`),
        version: 1,
        money: money(p, currency),
      })),
    })),
  };
}

function page<T>(items: T[], url: URL) {
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 25), 1),
    100,
  );
  const cursor = url.searchParams.get("cursor");
  let start = 0;
  if (cursor) {
    start = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isInteger(start) || start < 0) return null;
  }
  const slice = items.slice(start, start + limit);
  const next =
    start + limit < items.length ? base64url(String(start + limit)) : null;
  return { items: slice, nextCursor: next };
}

// ─── scenarios ───────────────────────────────────────────────────────────

const premium = products[0] as Product;
const silver = products[1] as Product;

function addOrder(
  persona: Persona,
  input: Partial<OrderRecord> & { product: Product },
) {
  const order: OrderRecord = {
    id: randomUUID(),
    userId: persona.id,
    currency: "RUB",
    status: "paid",
    createdAt: Date.now(),
    paidAt: null,
    checkout: {
      state: "ready",
      invoiceId: randomUUID(),
      returnUrl: `${APP_ORIGIN}/orders`,
    },
    subscriptionId: null,
    grant: null,
    settle: null,
    ...input,
  };
  orders.set(order.id, order);
  return order;
}

function addSubscription(
  persona: Persona,
  order: OrderRecord,
  input: Partial<SubscriptionRecord>,
) {
  const sub: SubscriptionRecord = {
    id: randomUUID(),
    userId: persona.id,
    orderId: order.id,
    product: order.product,
    currency: order.currency,
    state: "active",
    autoRenew: true,
    paidUntil: addMonth(order.paidAt ?? order.createdAt),
    cancelRequestedAt: null,
    cancelledAt: null,
    expiredAt: null,
    createdAt: order.paidAt ?? order.createdAt,
    ...input,
  };
  subscriptions.set(sub.id, sub);
  order.subscriptionId = sub.id;
  return sub;
}

/** A paid order with its grant (and subscription for Premium). */
function paid(
  persona: Persona,
  product: Product,
  currency: Currency,
  createdAt: number,
  sub: Partial<SubscriptionRecord> = {},
) {
  const order = addOrder(persona, {
    product,
    currency,
    status: "paid",
    createdAt,
    paidAt: createdAt + 2 * MINUTE,
  });
  if (product.kind === "subscription") addSubscription(persona, order, sub);
  order.grant = grantFor(order, order.paidAt as number);
  return order;
}

const scenarios: Record<string, (persona: Persona) => void> = {
  empty: () => {},
  // A buyer with some history: active Premium, Silver Fleet, a failed and a refunded payment.
  rich: (p) => {
    const now = Date.now();
    const refunded = paid(p, premium, "EUR", now - 96 * DAY, {
      state: "expired",
      autoRenew: false,
      cancelledAt: now - 70 * DAY,
      expiredAt: now - 62 * DAY,
    });
    refunded.status = "refunded";
    if (refunded.grant) {
      refunded.grant.state = "revoked";
      refunded.grant.validUntil = now - 65 * DAY;
    }
    const sub = refunded.subscriptionId
      ? subscriptions.get(refunded.subscriptionId)
      : undefined;
    if (sub) sub.paidUntil = now - 65 * DAY;
    addOrder(p, {
      product: silver,
      currency: "USD",
      status: "failed",
      createdAt: now - 5 * DAY - 3 * 60 * MINUTE,
    });
    paid(p, silver, "USD", now - 3 * DAY - 45 * MINUTE);
    paid(p, premium, "RUB", now - 20 * DAY - 7 * 60 * MINUTE);
  },
  // Just back from Lava, after an abandoned attempt three days ago.
  returning: (p) => {
    const now = Date.now();
    paid(p, silver, "RUB", now - 12 * DAY);
    addOrder(p, {
      product: premium,
      currency: "USD",
      status: "pending",
      createdAt: now - 3 * DAY,
    });
    addOrder(p, {
      product: premium,
      currency: "RUB",
      status: "pending",
      createdAt: now - 1 * MINUTE,
    });
  },
  // Every subscription state at once, for the subscription screen.
  states: (p) => {
    const now = Date.now();
    paid(p, premium, "RUB", now - 10 * DAY);
    paid(p, premium, "USD", now - 33 * DAY, {
      state: "past_due",
      paidUntil: now - 2 * DAY,
    });
    paid(p, premium, "EUR", now - 15 * DAY, {
      state: "cancel_requested",
      cancelRequestedAt: now - 2 * MINUTE,
    });
    paid(p, premium, "RUB", now - 25 * DAY, {
      state: "cancelling",
      autoRenew: false,
      cancelRequestedAt: now - 3 * DAY,
      cancelledAt: now - 3 * DAY,
    });
    paid(p, premium, "RUB", now - 70 * DAY, {
      state: "expired",
      autoRenew: false,
      paidUntil: now - 40 * DAY,
      expiredAt: now - 37 * DAY,
    });
  },
  // Enough history for a second page.
  many: (p) => {
    const now = Date.now();
    for (let i = 0; i < 26; i++) {
      const order = addOrder(p, {
        product: i % 2 ? silver : premium,
        currency: (["RUB", "USD", "EUR"] as Currency[])[i % 3],
        status: i % 5 === 0 ? "failed" : "paid",
        createdAt: now - (i + 1) * DAY,
        paidAt: i % 5 === 0 ? null : now - (i + 1) * DAY + MINUTE,
      });
      if (order.status === "paid")
        order.grant = grantFor(order, order.paidAt as number);
    }
  },
};

function createPersona(input: Record<string, unknown>) {
  const scenario = typeof input.scenario === "string" ? input.scenario : "rich";
  const build = scenarios[scenario];
  if (!build) return null;
  const id = randomUUID();
  const persona: Persona = {
    id,
    email:
      typeof input.email === "string"
        ? input.email
        : `buyer.${id.slice(0, 6)}@outegro.test`,
    displayName:
      typeof input.displayName === "string" ? input.displayName : null,
    roles: Array.isArray(input.roles)
      ? input.roles.filter((role): role is string => typeof role === "string")
      : [],
    identity: input.identity === "down" ? "down" : "up",
    locale: input.locale === "ru" ? "ru" : "en",
    createdAt: Date.now() - 120 * DAY,
    ip: typeof input.ip === "string" ? input.ip : null,
    payments: input.payments === "down" ? "down" : "up",
    catalog:
      (["empty", "closed", "down", "future"] as const).find(
        (m) => m === input.catalog,
      ) ?? "normal",
    cancelMode: input.cancelMode === "pending" ? "pending" : "confirm",
    checkoutMode:
      (["preparing", "failed", "offsite"] as const).find(
        (m) => m === input.checkoutMode,
      ) ?? "ready",
    accessTtlSec:
      typeof input.accessTtlSec === "number" ? input.accessTtlSec : 900,
    latencyMs: typeof input.latencyMs === "number" ? input.latencyMs : 0,
    log: {
      refreshes: 0,
      logouts: 0,
      checkouts: [],
      cancels: [],
      orderPolls: 0,
    },
  };
  personas.set(id, persona);
  build(persona);
  return persona;
}

function personaOrders(personaId: string) {
  return [...orders.values()]
    .filter((o) => o.userId === personaId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function personaSubscriptions(personaId: string) {
  return [...subscriptions.values()]
    .filter((s) => s.userId === personaId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function describe(persona: Persona) {
  return {
    id: persona.id,
    email: persona.email,
    orders: personaOrders(persona.id).map((o) => ({
      id: o.id,
      productKey: o.product.key,
      status: o.status,
      subscriptionId: o.subscriptionId,
    })),
    subscriptions: personaSubscriptions(persona.id).map((s) => ({
      id: s.id,
      state: s.state,
      orderId: s.orderId,
    })),
    log: persona.log,
  };
}

// ─── routes ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9._:-]{8,128}$/;

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  // ── control ──
  if (path === "/__control/health") return send(res, 200, { status: "ok" });
  if (path === "/__control/personas" && method === "POST") {
    const body = await readBody(req);
    const persona = createPersona(isRecord(body) ? body : {});
    return persona
      ? send(res, 201, describe(persona))
      : error(res, 400, "VALIDATION_FAILED");
  }
  let match = /^\/__control\/personas\/([^/]+)$/.exec(path);
  if (match) {
    const persona = personas.get(match[1] as string);
    if (!persona) return error(res, 404, "NOT_FOUND");
    if (method === "PATCH") {
      const body = await readBody(req);
      if (isRecord(body)) {
        if (body.payments === "up" || body.payments === "down")
          persona.payments = body.payments;
        const catalog = (
          ["normal", "empty", "closed", "down", "future"] as const
        ).find((m) => m === body.catalog);
        if (catalog) persona.catalog = catalog;
        if (body.cancelMode === "confirm" || body.cancelMode === "pending")
          persona.cancelMode = body.cancelMode;
        if (typeof body.latencyMs === "number")
          persona.latencyMs = body.latencyMs;
      }
    }
    return send(res, 200, describe(persona));
  }
  match = /^\/__control\/orders\/([^/]+)\/settle$/.exec(path);
  if (match && method === "POST") {
    const order = orders.get(match[1] as string);
    const body = await readBody(req);
    if (!order || !isRecord(body)) return error(res, 404, "NOT_FOUND");
    const outcome = body.outcome === "failed" ? "failed" : "paid";
    const at =
      Date.now() + (typeof body.afterMs === "number" ? body.afterMs : 0);
    const accessAt =
      typeof body.accessAfterMs === "number"
        ? Date.now() + body.accessAfterMs
        : null;
    order.settle = { outcome, at, accessAt };
    return send(res, 200, { ok: true });
  }
  match = /^\/__control\/invoices\/([^/]+)$/.exec(path);
  if (match) {
    const order = [...orders.values()].find(
      (o) => o.checkout?.invoiceId === match?.[1],
    );
    if (!order?.checkout) return error(res, 404, "NOT_FOUND");
    const back = (result: string) => {
      const target = new URL(
        order.checkout?.returnUrl ?? `${APP_ORIGIN}/orders`,
      );
      target.searchParams.set("orderId", order.id);
      target.searchParams.set("result", result);
      return target.toString();
    };
    return send(res, 200, {
      orderId: order.id,
      success: back("success"),
      failure: back("failure"),
    });
  }

  // ── identity ──
  if (path === "/authorize" && method === "GET") {
    const personaId = cookie(req, "fake_persona");
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (
      !personaId ||
      !personas.has(personaId) ||
      url.searchParams.get("client_id") !== "pay-web" ||
      redirectUri !== `${APP_ORIGIN}/auth/callback` ||
      url.searchParams.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      state.length < 16
    ) {
      res.writeHead(400, { "content-type": "text/html" });
      res.end(
        "<!doctype html><title>Invalid sign-in request</title><h1>Invalid sign-in request</h1>",
      );
      return;
    }
    const code = randomBytes(32).toString("base64url");
    codes.set(code, { personaId, challenge, redirectUri });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString() });
    res.end();
    return;
  }
  if (path === "/v1/oauth/token" && method === "POST") {
    const body = await readBody(req);
    if (!isRecord(body)) return error(res, 400, "VALIDATION_FAILED");
    const entry =
      typeof body.code === "string" ? codes.get(body.code) : undefined;
    if (typeof body.code === "string") codes.delete(body.code);
    const verifier =
      typeof body.codeVerifier === "string" ? body.codeVerifier : "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (
      !entry ||
      body.grantType !== "authorization_code" ||
      body.clientId !== "pay-web" ||
      body.redirectUri !== entry.redirectUri ||
      challenge !== entry.challenge
    )
      return error(res, 422, "UNPROCESSABLE", { code: ["invalid_grant"] });
    return send(res, 200, issueTokens(entry.personaId));
  }
  if (path === "/v1/sessions/refresh" && method === "POST") {
    const body = await readBody(req);
    const presented =
      isRecord(body) && typeof body.refreshToken === "string"
        ? body.refreshToken
        : "";
    const sessionId = refreshIndex.get(presented);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!sessionId || !session || session.revoked)
      return error(res, 401, "UNAUTHENTICATED");
    const persona = personas.get(session.personaId);
    if (persona) persona.log.refreshes += 1;
    refreshIndex.delete(presented);
    session.refreshToken = randomBytes(48).toString("base64url");
    refreshIndex.set(session.refreshToken, sessionId);
    return send(res, 200, tokensFor(sessionId, persona?.accessTtlSec ?? 900));
  }
  if (path === "/v1/sessions/logout" && method === "POST") {
    const body = await readBody(req);
    const presented =
      isRecord(body) && typeof body.refreshToken === "string"
        ? body.refreshToken
        : "";
    const sessionId = refreshIndex.get(presented);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (session) {
      session.revoked = true;
      const persona = personas.get(session.personaId);
      if (persona) persona.log.logouts += 1;
    }
    return send(res, 204);
  }
  if (path === "/v1/me" && method === "GET") {
    const persona = personaFromToken(req);
    if (!persona) return error(res, 401, "UNAUTHENTICATED");
    if (persona.identity === "down")
      return error(res, 503, "DEPENDENCY_UNAVAILABLE");
    return send(res, 200, {
      id: persona.id,
      email: persona.email,
      emailVerified: true,
      displayName: persona.displayName,
      locale: persona.locale,
      status: "active",
      version: 1,
      createdAt: iso(persona.createdAt),
      roles: persona.roles,
      permissions: [],
    });
  }

  // ── payments ──
  if (path === "/v1/catalog" && method === "GET") {
    const persona = personaFromIp(req);
    if (persona?.latencyMs) await sleep(persona.latencyMs);
    if (persona?.catalog === "down" || persona?.payments === "down")
      return error(res, 503, "DEPENDENCY_UNAVAILABLE");
    return send(res, 200, catalogView(persona));
  }
  if (!path.startsWith("/v1/me/") && path !== "/v1/checkout")
    return error(res, 404, "NOT_FOUND");

  const persona = personaFromToken(req);
  if (!persona) return error(res, 401, "UNAUTHENTICATED");
  if (persona.latencyMs) await sleep(persona.latencyMs);
  if (persona.payments === "down")
    return error(res, 503, "DEPENDENCY_UNAVAILABLE");

  if (path === "/v1/me/orders" && method === "GET") {
    const result = page(personaOrders(persona.id).map(orderView), url);
    return result
      ? send(res, 200, result)
      : error(res, 400, "VALIDATION_FAILED", { cursor: ["invalid"] });
  }
  match = /^\/v1\/me\/orders\/([^/]+)$/.exec(path);
  if (match && method === "GET") {
    const order = orders.get(match[1] as string);
    persona.log.orderPolls += 1;
    if (!order || order.userId !== persona.id || !UUID.test(match[1] as string))
      return error(res, 404, "NOT_FOUND");
    return send(res, 200, orderView(order));
  }
  if (path === "/v1/me/subscriptions" && method === "GET") {
    const result = page(
      personaSubscriptions(persona.id).map(subscriptionView),
      url,
    );
    return result
      ? send(res, 200, result)
      : error(res, 400, "VALIDATION_FAILED", { cursor: ["invalid"] });
  }
  match = /^\/v1\/me\/subscriptions\/([^/]+)\/cancel$/.exec(path);
  if (match && method === "POST") {
    const sub = subscriptions.get(match[1] as string);
    if (!sub || sub.userId !== persona.id) return error(res, 404, "NOT_FOUND");
    persona.log.cancels.push(sub.id);
    const now = Date.now();
    if (sub.state === "active" || sub.state === "past_due") {
      sub.cancelRequestedAt = now;
      if (persona.cancelMode === "pending") {
        sub.state = "cancel_requested";
      } else {
        sub.state = "cancelling";
        sub.autoRenew = false;
        sub.cancelledAt = now;
      }
    }
    return send(res, 200, subscriptionView(sub));
  }
  if (path === "/v1/checkout" && method === "POST") {
    const key = String(req.headers["idempotency-key"] ?? "");
    if (!KEY.test(key))
      return error(res, 400, "VALIDATION_FAILED", {
        "Idempotency-Key": ["required"],
      });
    const body = await readBody(req);
    if (
      !isRecord(body) ||
      Object.keys(body).some(
        (k) => !["productKey", "currency", "returnUrl"].includes(k),
      )
    )
      return error(res, 400, "VALIDATION_FAILED");
    const product =
      typeof body.productKey === "string"
        ? productByKey(body.productKey)
        : undefined;
    const currency = body.currency as Currency;
    const returnUrl =
      typeof body.returnUrl === "string" ? body.returnUrl : null;
    if (!["RUB", "USD", "EUR"].includes(currency))
      return error(res, 400, "VALIDATION_FAILED");
    if (returnUrl && new URL(returnUrl).origin !== APP_ORIGIN)
      return error(res, 400, "VALIDATION_FAILED", {
        returnUrl: ["origin not allowed"],
      });
    persona.log.checkouts.push({
      key,
      productKey: String(body.productKey),
      currency: String(currency),
      returnUrl,
    });
    const fingerprint = JSON.stringify([body.productKey, currency, returnUrl]);
    const scope = `${persona.id}:${key}`;
    const existing = checkoutKeys.get(scope);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        return error(res, 409, "IDEMPOTENCY_CONFLICT");
      const order = orders.get(existing.orderId) as OrderRecord;
      // A repeated "preparing" call finds the invoice ready.
      if (
        order.checkout?.state === "requesting" &&
        persona.checkoutMode === "preparing"
      )
        order.checkout.state = "ready";
      return send(res, 200, checkoutResult(order));
    }
    if (!product) return error(res, 404, "NOT_FOUND");
    if (persona.catalog === "closed")
      return error(res, 422, "UNPROCESSABLE", {
        checkout: ["sales are closed"],
      });
    const owned = personaOrders(persona.id).some(
      (o) =>
        o.product.key === product.key &&
        ((product.kind === "one_time" && o.grant?.state === "active") ||
          (o.subscriptionId &&
            ["active", "past_due", "cancel_requested"].includes(
              subscriptions.get(o.subscriptionId)?.state ?? "",
            ))),
    );
    if (owned)
      return error(res, 422, "ALREADY_OWNED", {
        productKey: [
          product.kind === "one_time" ? "already owned" : "already subscribed",
        ],
      });
    const order = addOrder(persona, {
      product,
      currency,
      status: persona.checkoutMode === "failed" ? "failed" : "pending",
      createdAt: Date.now(),
      paidAt: null,
      checkout: {
        state:
          persona.checkoutMode === "failed"
            ? "failed"
            : persona.checkoutMode === "preparing"
              ? "requesting"
              : "ready",
        invoiceId: randomUUID(),
        returnUrl: returnUrl ?? `${APP_ORIGIN}/checkout/result`,
      },
    });
    checkoutKeys.set(scope, { fingerprint, orderId: order.id });
    return send(res, 200, checkoutResult(order));
  }
  return error(res, 404, "NOT_FOUND");
}

function checkoutResult(order: OrderRecord) {
  const view = orderView(order);
  return {
    orderId: order.id,
    attemptId: order.checkout?.invoiceId ?? randomUUID(),
    state: order.checkout?.state ?? "unknown",
    status: order.status,
    paymentUrl: view.checkout?.paymentUrl ?? null,
  };
}

createServer((req, res) => {
  handle(req, res).catch((cause: unknown) => {
    console.error("[fake-platform]", cause);
    if (!res.headersSent) error(res, 500, "INTERNAL");
    else res.end();
  });
}).listen(PORT, () => {
  console.log(
    `[fake-platform] identity + payments on http://localhost:${PORT}`,
  );
});
