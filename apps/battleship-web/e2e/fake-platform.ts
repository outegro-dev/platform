/**
 * Hermetic stand-in for the platform services during e2e tests (port 4195):
 * identity (SSO /authorize page, code exchange with PKCE, refresh, logout
 * that revokes the session, access token included), battleship-backend HTTP
 * and payments. Every battleship response is parsed
 * with the contract schemas before it is sent, so the app is tested against
 * the real wire format. The game WebSocket is mocked inside the browser by
 * Playwright (page.routeWebSocket), not here.
 *
 *   node e2e/fake-platform.ts
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  classicRules,
  HuntAndTarget,
  Match,
  RandomPlacement,
  SeededRandom,
} from "@outegro/battleship-engine";
import { pageSchema, permissionsOf } from "@outegro/contracts";
import {
  cosmeticUnlocked,
  effectiveCosmetics,
  leaderboardSchema,
  matchReplaySchema,
  matchSummarySchema,
  playerProfileSchema,
  playerStatsSchema,
  updateProfileSchema,
  wsTicketSchema,
} from "@outegro/contracts/battleship";
import { z } from "zod";
import {
  accounts,
  emailOf,
  encodeTicket,
  isPersona,
  type Persona,
  personas,
} from "./support/personas.ts";

const PORT = Number(process.env.FAKE_PLATFORM_PORT ?? 4195);
const APP_ORIGIN = process.env.FAKE_APP_ORIGIN ?? "http://localhost:3195";
const CALLBACK = `${APP_ORIGIN}/auth/callback`;
const CHECKOUT_ORIGIN = "https://checkout.fake.test";

type Cosmetics = {
  ships: "classic" | "silver";
  hitEffect: "flame" | "shards";
  theme: "day" | "night-sea";
};

type User = {
  id: string;
  persona: Persona;
  nickname: string;
  rating: number;
  matches: number;
  wins: number;
  features: Set<string>;
  equipped: Cosmetics;
  failTickets: number;
  /** The Premium subscription payments holds (renewal and cancellation). */
  subscription: { state: string; autoRenew: boolean } | null;
};

const users = new Map<string, User>();
const codes = new Map<
  string,
  { persona: Persona; challenge: string; redirectUri: string; clientId: string }
>();
/** Identity sessions by id; a logout revokes one, access token included. */
const sessions = new Map<string, { userId: string; revoked: boolean }>();
/** Refresh token → session id. */
const refreshTokens = new Map<string, string>();
type Order = {
  orderId: string;
  userId: string;
  input: string;
  calls: number;
  productKey: string;
  feature: string;
};
/** By Idempotency-Key, and by order id for the status endpoint. */
const orders = new Map<string, Order>();
const ordersById = new Map<string, Order>();
const takenNicknames = new Set(["taken name", "admiral nelson"]);

// ─── helpers ─────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  res.setHeader("cache-control", "no-store");
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader("content-type", "application/json");
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
      requestId: randomUUID(),
      retryable: status >= 500,
    },
  });
}

/** Sends a battleship payload only if it matches the contract. */
function contract<T>(res: ServerResponse, schema: z.ZodType<T>, body: unknown) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.error(
      "[fake-platform] response breaks the contract",
      parsed.error.issues,
    );
    error(res, 500, "INTERNAL");
    return;
  }
  send(res, 200, parsed.data);
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

function cookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function jwt(payload: Record<string, unknown>): string {
  const head = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.${randomBytes(16).toString("base64url")}`;
}

/** Tokens of a new session for `userId`, or rotated ones of session `sid`. */
function issueTokens(userId: string, sid: string = randomUUID()) {
  const now = Date.now();
  const refreshToken = randomBytes(32).toString("base64url");
  sessions.set(sid, { userId, revoked: false });
  refreshTokens.set(refreshToken, sid);
  return {
    sessionId: sid,
    accessToken: jwt({ sub: userId, sid, exp: Math.floor(now / 1000) + 900 }),
    accessTokenExpiresAt: new Date(now + 900_000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: new Date(now + 30 * 86_400_000).toISOString(),
  };
}

/** The user behind a Bearer token of a live session (every service checks it). */
function userFrom(req: IncomingMessage): User | null {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: string; sid?: string; exp?: number };
    if (!payload.sub || !payload.exp || payload.exp * 1000 < Date.now())
      return null;
    const session = payload.sid ? sessions.get(payload.sid) : undefined;
    if (!session || session.revoked || session.userId !== payload.sub)
      return null;
    return users.get(payload.sub) ?? null;
  } catch {
    return null;
  }
}

function createUser(persona: Persona): User {
  const base = personas[persona];
  const user: User = {
    id: randomUUID(),
    persona,
    nickname: base.nickname,
    rating: base.rating,
    matches: base.matches,
    wins: base.wins,
    features: new Set(base.features),
    equipped: { ...base.equipped },
    failTickets: persona === "unlucky" ? 3 : 0,
    // Premium comes from a renewing subscription, except for the persona
    // whose grant outlived it.
    subscription:
      persona === "premium" ? { state: "active", autoRenew: true } : null,
  };
  users.set(user.id, user);
  return user;
}

/** Payments' view of the user's subscriptions (GET /v1/me/subscriptions). */
function subscriptionsOf(user: User) {
  const sub = user.subscription;
  return {
    items: sub
      ? [
          {
            id: "5e0c0de0-0000-4000-8000-000000000001",
            orderId: "5e0c0de0-0000-4000-8000-000000000002",
            productKey: "battleship-premium",
            title: { en: "Battleship Premium", ru: "Battleship Premium" },
            state: sub.state,
            autoRenew: sub.autoRenew,
            paidUntil: "2026-10-29T12:00:00.000Z",
            accessUntil: "2026-11-01T12:00:00.000Z",
            money: { minor: "5000", currency: "RUB", scale: 2 },
            periodicity: "MONTHLY",
            cancelRequestedAt: null,
            cancelledAt: null,
            expiredAt: null,
            createdAt: "2026-09-29T12:00:00.000Z",
          },
        ]
      : [],
    nextCursor: null,
  };
}

function profileOf(user: User) {
  const premium = user.features.has("premium");
  return {
    userId: user.id,
    nickname: user.nickname,
    rating: user.rating,
    provisional: user.matches < 30,
    matches: user.matches,
    wins: user.wins,
    premium,
    premiumUntil: premium ? "2026-10-29T12:00:00.000Z" : null,
    features: [...user.features],
    cosmetics: {
      equipped: { ...user.equipped },
      effective: effectiveCosmetics(user.equipped, user.features),
    },
  };
}

// ─── fixtures ────────────────────────────────────────────────────────────

const captains = [
  ["Nemo", 1512, 88, 120, true],
  ["Admiral Nelson", 1342, 41, 64, true],
  ["Grace O'Malley", 1298, 52, 90, false],
  ["Horatio", 1244, 30, 51, false],
  ["Captain Blood", 1217, 33, 60, true],
  ["Silver Mira", 1188, 13, 22, false],
  ["Ahab", 1150, 25, 58, false],
  ["Morgan", 1121, 19, 40, false],
  ["Sailor 4821", 1016, 7, 12, false],
  ["Jack Aubrey", 1004, 9, 20, false],
  ["Ishmael", 987, 6, 18, false],
  ["Queequeg", 962, 4, 15, false],
] as const;

function leaderboard(period: "all" | "week", user: User | null) {
  const rows =
    period === "all"
      ? captains.map(([nickname, rating, wins, matches, premium], i) => ({
          rank: i + 1,
          nickname,
          rating,
          wins,
          matches,
          premium,
        }))
      : captains.slice(0, 6).map(([nickname, rating, , , premium], i) => ({
          rank: i + 1,
          nickname,
          rating,
          wins: 5 - Math.min(4, i),
          matches: 6,
          premium,
          gained: 64 - i * 11,
        }));
  let you = null;
  if (user) {
    const index = rows.findIndex((row) => row.nickname === user.nickname);
    you =
      period === "all"
        ? {
            rank: index >= 0 ? index + 1 : user.matches > 0 ? 42 : null,
            rating: user.rating,
            wins: user.wins,
            matches: user.matches,
          }
        : {
            rank: index >= 0 ? index + 1 : null,
            rating: user.rating,
            wins: index >= 0 ? (rows[index]?.wins ?? 0) : 0,
            matches: index >= 0 ? 6 : 0,
            gained: index >= 0 ? (rows[index] as { gained: number }).gained : 0,
          };
  }
  return {
    period,
    since: period === "week" ? "2026-09-28T00:00:00.000Z" : null,
    items: rows,
    you,
  };
}

function stats(user: User) {
  const premium = user.features.has("premium");
  return {
    matches: user.matches,
    wins: user.wins,
    losses: user.matches - user.wins,
    winRate: user.matches ? user.wins / user.matches : null,
    accuracy: user.matches ? 0.47 : null,
    currentStreak: user.matches ? 2 : 0,
    longestStreak: user.matches ? 5 : 0,
    averageMovesToWin: user.wins ? 58.4 : null,
    botWins: {
      easy: 9,
      medium: 5,
      hard: premium ? 3 : 0,
      expert: premium ? 1 : 0,
    },
    heatmap: premium
      ? Array.from({ length: 10 }, (_, y) =>
          Array.from({ length: 10 }, (_, x) =>
            Math.max(
              0,
              Math.round(
                12 - Math.hypot(x - 4, y - 5) * 2.2 + ((x * 3 + y * 7) % 5),
              ),
            ),
          ),
        )
      : null,
  };
}

const opponents = [
  { kind: "bot", level: "easy" },
  { kind: "human", nickname: "Nemo", rating: 1512, premium: true },
  { kind: "bot", level: "medium" },
  { kind: "human", nickname: "Ahab", rating: 1150, premium: false },
  { kind: "bot", level: "hard" },
] as const;

function history(cursor: string | null, limit: number) {
  const all = Array.from({ length: 23 }, (_, i) => {
    const opponent = opponents[i % opponents.length] ?? opponents[0];
    const quick = opponent.kind === "human";
    const win = i % 3 !== 1;
    return {
      matchId: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
      mode: quick ? (i % 2 ? "quick" : "private") : "bot",
      opponent,
      result: win ? "win" : "loss",
      reason: i % 7 === 3 ? "resigned" : "fleet_destroyed",
      moves: 38 + ((i * 7) % 40),
      ratingDelta:
        quick && i % 2 ? (win ? 14 + (i % 5) : -(10 + (i % 4))) : null,
      finishedAt: new Date(
        Date.UTC(2026, 8, 29, 12) - i * 5_400_000,
      ).toISOString(),
    };
  });
  const start = cursor ? Number(cursor.replace("c", "")) : 0;
  const items = all.slice(start, start + limit);
  const next = start + limit < all.length ? `c${start + limit}` : null;
  return { items, nextCursor: next };
}

/** A quick match the opponent lost on the placement clock: no fleet, no shots. */
const UNDEPLOYED_MATCH = "00000000-0000-4000-8000-000000002000";

/** A realistic replay: two random fleets and medium bots, played by the engine. */
function replay(matchId: string) {
  if (matchId === UNDEPLOYED_MATCH) {
    return {
      matchId,
      mode: "quick",
      opponent: {
        kind: "human",
        nickname: "Ahab",
        rating: 1150,
        premium: false,
      },
      winner: "you",
      reason: "timeout",
      fleets: {
        you: new RandomPlacement(new SeededRandom(3)).place(classicRules),
        opponent: [],
      },
      moves: [],
      startedAt: "2026-09-29T10:00:00.000Z",
      finishedAt: "2026-09-29T10:01:30.000Z",
    };
  }
  const random = new SeededRandom(matchId.length + 7);
  const match = new Match(matchId, ["you", "opponent"], classicRules, "you");
  const fleets = {
    you: new RandomPlacement(random).place(classicRules),
    opponent: new RandomPlacement(random).place(classicRules),
  };
  match.placeFleet("you", fleets.you);
  match.placeFleet("opponent", fleets.opponent);
  const bots = {
    you: new HuntAndTarget(random),
    opponent: new HuntAndTarget(random),
  };
  const moves: {
    n: number;
    by: "you" | "opponent";
    x: number;
    y: number;
    outcome: "miss" | "hit" | "sunk";
  }[] = [];
  while (match.currentPhase === "battle" && moves.length < 200) {
    const by = match.currentTurn as "you" | "opponent";
    const view = match.viewFor(by).target;
    if (!view) break;
    const target = bots[by].next(view);
    const events = match.fire(by, target.x, target.y);
    const shot = events.find((event) => event.type === "shot");
    if (shot && shot.type === "shot") {
      moves.push({
        n: moves.length + 1,
        by,
        x: target.x,
        y: target.y,
        outcome: shot.report.outcome,
      });
    }
  }
  const result = match.result;
  return {
    matchId,
    mode: "bot",
    opponent: { kind: "bot", level: "medium" },
    winner: result?.winner === "opponent" ? "opponent" : "you",
    reason: "fleet_destroyed",
    fleets,
    moves,
    startedAt: "2026-09-29T10:00:00.000Z",
    finishedAt: "2026-09-29T10:12:00.000Z",
  };
}

// ─── payments (final API shapes) ─────────────────────────────────────────

const prices = [
  { currency: "RUB", minor: "5000", scale: 2 },
  { currency: "USD", minor: "59", scale: 2 },
  { currency: "EUR", minor: "52", scale: 2 },
] as const;

function product(
  key: string,
  service: string,
  feature: string,
  monthly: boolean,
  title: { en: string; ru: string },
) {
  return {
    key,
    service,
    feature,
    kind: monthly ? "subscription" : "one_time",
    periodicity: monthly ? "MONTHLY" : "ONE_TIME",
    graceDays: monthly ? 3 : 0,
    title,
    description: {
      en: monthly
        ? "Everything the game has, while it lasts."
        : "Silver ships, shards and the night sea, forever.",
      ru: monthly
        ? "Всё, что есть в игре, пока действует подписка."
        : "Серебряные корабли, осколки и ночное море — навсегда.",
    },
    prices: prices.map((money, i) => ({
      priceId: `${key}-${money.currency.toLowerCase()}`,
      version: 1 + i,
      money,
    })),
  };
}

const catalogResponseSchema = z.object({
  checkoutEnabled: z.boolean(),
  products: z.array(
    z
      .object({ key: z.string(), service: z.string(), feature: z.string() })
      .passthrough(),
  ),
});
const checkoutBodySchema = z
  .object({
    productKey: z.string(),
    currency: z.enum(["RUB", "USD", "EUR"]),
    returnUrl: z.url().optional(),
  })
  .strict();

// ─── routes ──────────────────────────────────────────────────────────────

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  // Identity's API (AUTH_API_URL) lives under /identity: its /v1/me must not
  // collide with the game server's /v1/me on this one port.
  const identity = url.pathname.startsWith("/identity/");
  const path = identity ? url.pathname.slice("/identity".length) : url.pathname;
  const method = req.method ?? "GET";

  if (path === "/health") return send(res, 200, { status: "ok" });

  // Identity: who is signed in, for the account menu.
  if (identity && path === "/v1/me" && method === "GET") {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const account = accounts[user.persona];
    return send(res, 200, {
      id: user.id,
      email: emailOf(user.persona),
      emailVerified: true,
      displayName: account.displayName,
      locale: "en",
      status: "active",
      version: 1,
      createdAt: "2026-06-01T10:00:00.000Z",
      roles: account.roles,
      permissions: [...permissionsOf(account.roles)].sort(),
    });
  }

  // Identity: the SSO entry id.outegro.dev would show; here it signs in at once.
  if (path === "/authorize" && method === "GET") {
    const q = url.searchParams;
    const persona = cookie(req, "e2e_persona");
    if (
      q.get("client_id") !== "battleship-web" ||
      q.get("redirect_uri") !== CALLBACK ||
      q.get("code_challenge_method") !== "S256" ||
      !q.get("state") ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "")
    ) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html");
      return res.end(
        "<!doctype html><title>Invalid</title><h1>This link is not valid</h1>",
      );
    }
    const code = randomBytes(32).toString("base64url");
    codes.set(code, {
      persona: isPersona(persona) ? persona : "free",
      challenge: q.get("code_challenge") ?? "",
      redirectUri: CALLBACK,
      clientId: "battleship-web",
    });
    const target = new URL(CALLBACK);
    target.searchParams.set("code", code);
    target.searchParams.set("state", q.get("state") ?? "");
    res.statusCode = 302;
    res.setHeader("location", target.toString());
    return res.end();
  }

  if (path === "/v1/oauth/token" && method === "POST") {
    const body = (await readBody(req)) as Record<string, string> | undefined;
    const pending = body?.code ? codes.get(body.code) : undefined;
    if (!body || !pending)
      return error(res, 422, "UNPROCESSABLE", { code: ["invalid_grant"] });
    codes.delete(body.code as string);
    const challenge = createHash("sha256")
      .update(body.codeVerifier ?? "")
      .digest("base64url");
    if (
      body.grantType !== "authorization_code" ||
      body.clientId !== pending.clientId ||
      body.redirectUri !== pending.redirectUri ||
      challenge !== pending.challenge
    ) {
      return error(res, 422, "UNPROCESSABLE", { code: ["invalid_grant"] });
    }
    const user = createUser(pending.persona);
    return send(res, 200, issueTokens(user.id));
  }

  if (path === "/v1/sessions/refresh" && method === "POST") {
    const body = (await readBody(req)) as { refreshToken?: string } | undefined;
    const sid = body?.refreshToken
      ? refreshTokens.get(body.refreshToken)
      : undefined;
    const session = sid ? sessions.get(sid) : undefined;
    if (!sid || !session || session.revoked || !body?.refreshToken)
      return error(res, 401, "UNAUTHENTICATED");
    refreshTokens.delete(body.refreshToken);
    return send(res, 200, issueTokens(session.userId, sid));
  }

  if (path === "/v1/sessions/logout" && method === "POST") {
    const body = (await readBody(req)) as { refreshToken?: string } | undefined;
    const sid = body?.refreshToken
      ? refreshTokens.get(body.refreshToken)
      : undefined;
    const session = sid ? sessions.get(sid) : undefined;
    if (session) session.revoked = true;
    if (body?.refreshToken) refreshTokens.delete(body.refreshToken);
    return send(res, 204);
  }

  // Payments: public catalog and checkout.
  if (path === "/v1/catalog" && method === "GET") {
    const body = {
      checkoutEnabled: true,
      products: [
        product("battleship-premium", "battleship", "premium", true, {
          en: "Battleship Premium",
          ru: "Battleship Premium",
        }),
        product(
          "battleship-silver-fleet",
          "battleship",
          "cosmetics.silver-fleet",
          false,
          { en: "Silver Fleet", ru: "Серебряный флот" },
        ),
        product("assistant-pro", "assistant", "pro", true, {
          en: "Assistant Pro",
          ru: "Assistant Pro",
        }),
      ],
    };
    catalogResponseSchema.parse(body);
    return send(res, 200, body);
  }

  if (path === "/v1/checkout" && method === "POST") {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const key = String(req.headers["idempotency-key"] ?? "");
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return error(res, 400, "VALIDATION_FAILED", {
        "idempotency-key": ["invalid"],
      });
    const raw = await readBody(req);
    const body = checkoutBodySchema.safeParse(raw);
    if (!body.success) return error(res, 400, "VALIDATION_FAILED");
    const feature =
      body.data.productKey === "battleship-premium"
        ? "premium"
        : body.data.productKey === "battleship-silver-fleet"
          ? "cosmetics.silver-fleet"
          : null;
    if (!feature) return error(res, 404, "NOT_FOUND");
    if (body.data.returnUrl && body.data.returnUrl !== `${APP_ORIGIN}/shop`) {
      return error(res, 400, "VALIDATION_FAILED", {
        returnUrl: ["origin_not_allowed"],
      });
    }
    if (user.features.has(feature))
      return error(res, 422, "ALREADY_OWNED", {
        productKey: ["already owned"],
      });
    const input = JSON.stringify(body.data);
    let order = orders.get(key);
    if (order && order.input !== input)
      return error(res, 409, "IDEMPOTENCY_CONFLICT");
    if (!order) {
      order = {
        orderId: randomUUID(),
        userId: user.id,
        input,
        calls: 0,
        productKey: body.data.productKey,
        feature,
      };
      orders.set(key, order);
      ordersById.set(order.orderId, order);
    }
    order.calls++;
    // The first answer has no page yet: the client retries with the same key.
    if (order.calls === 1) {
      return send(res, 200, {
        orderId: order.orderId,
        attemptId: null,
        state: "requesting",
        status: "new",
        paymentUrl: null,
      });
    }
    const pay = new URL(`/pay/${order.orderId}`, CHECKOUT_ORIGIN);
    if (body.data.returnUrl)
      pay.searchParams.set("return", body.data.returnUrl);
    pay.searchParams.set("order", order.orderId);
    return send(res, 200, {
      orderId: order.orderId,
      attemptId: randomUUID(),
      state: "pending",
      status: "awaiting_payment",
      paymentUrl: pay.toString(),
    });
  }

  const orderPath = /^\/v1\/me\/orders\/([0-9a-f-]{36})$/.exec(path);
  if (orderPath && method === "GET") {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    const order = ordersById.get(orderPath[1] ?? "");
    if (!order || order.userId !== user.id) return error(res, 404, "NOT_FOUND");
    return send(res, 200, {
      orderId: order.orderId,
      productKey: order.productKey,
      status: user.features.has(order.feature) ? "paid" : "pending",
    });
  }

  if (path === "/v1/me/subscriptions" && method === "GET") {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");
    return send(res, 200, subscriptionsOf(user));
  }

  // Test control: grants (the webhook), failing tickets, subscriptions, user state.
  const control =
    /^\/__test\/users\/([0-9a-f-]{36})(?:\/(grant|tickets|subscription))?$/.exec(
      path,
    );
  if (control) {
    const user = users.get(control[1] ?? "");
    if (!user) return send(res, 404, { error: "no such user" });
    if (control[2] === "grant" && method === "POST") {
      const body = (await readBody(req)) as { feature?: string } | undefined;
      if (body?.feature) user.features.add(body.feature);
      // A Premium grant comes from a subscription payments now holds.
      if (body?.feature === "premium")
        user.subscription = { state: "active", autoRenew: true };
      return send(res, 200, profileOf(user));
    }
    if (control[2] === "subscription" && method === "POST") {
      const body = (await readBody(req)) as
        | { state?: string; autoRenew?: boolean }
        | undefined;
      user.subscription = body?.state
        ? { state: body.state, autoRenew: body.autoRenew ?? true }
        : null;
      return send(res, 200, subscriptionsOf(user));
    }
    if (control[2] === "tickets" && method === "POST") {
      const body = (await readBody(req)) as { fail?: number } | undefined;
      user.failTickets = body?.fail ?? 0;
      return send(res, 200, { failTickets: user.failTickets });
    }
    return send(res, 200, profileOf(user));
  }

  // Battleship HTTP.
  if (path === "/v1/leaderboard" && method === "GET") {
    const period = url.searchParams.get("period") === "week" ? "week" : "all";
    return contract(res, leaderboardSchema, leaderboard(period, userFrom(req)));
  }

  if (path.startsWith("/v1/")) {
    const user = userFrom(req);
    if (!user) return error(res, 401, "UNAUTHENTICATED");

    if (path === "/v1/me" && method === "GET")
      return contract(res, playerProfileSchema, profileOf(user));

    if (path === "/v1/me" && method === "PATCH") {
      const parsed = updateProfileSchema.safeParse(await readBody(req));
      if (!parsed.success) return error(res, 400, "VALIDATION_FAILED");
      const { nickname, cosmetics } = parsed.data;
      if (nickname !== undefined) {
        if (
          takenNicknames.has(nickname.toLowerCase()) &&
          nickname.toLowerCase() !== user.nickname.toLowerCase()
        ) {
          return error(res, 409, "CONFLICT", { nickname: ["taken"] });
        }
        user.nickname = nickname;
      }
      if (cosmetics) {
        for (const [slot, item] of Object.entries(cosmetics)) {
          if (
            !cosmeticUnlocked(
              slot as keyof Cosmetics,
              item as never,
              user.features,
            )
          ) {
            return error(res, 403, "FORBIDDEN");
          }
        }
        user.equipped = { ...user.equipped, ...cosmetics } as Cosmetics;
      }
      return contract(res, playerProfileSchema, profileOf(user));
    }

    if (path === "/v1/ws-tickets" && method === "POST") {
      if (user.failTickets > 0) {
        user.failTickets--;
        return error(res, 503, "DEPENDENCY_UNAVAILABLE");
      }
      return contract(res, wsTicketSchema, {
        ticket: encodeTicket({
          uid: user.id,
          persona: user.persona,
          n: Date.now(),
        }),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
    }

    if (path === "/v1/me/stats" && method === "GET")
      return contract(res, playerStatsSchema, stats(user));

    if (path === "/v1/me/matches" && method === "GET") {
      const limit = Math.min(
        100,
        Number(url.searchParams.get("limit") ?? 25) || 25,
      );
      return contract(
        res,
        pageSchema(matchSummarySchema),
        history(url.searchParams.get("cursor"), limit),
      );
    }

    const replayPath = /^\/v1\/matches\/([0-9a-f-]{36})\/replay$/.exec(path);
    if (replayPath && method === "GET") {
      if (!user.features.has("premium")) return error(res, 403, "FORBIDDEN");
      return contract(res, matchReplaySchema, replay(replayPath[1] ?? ""));
    }
  }

  return error(res, 404, "NOT_FOUND");
}

createServer((req, res) => {
  handle(req, res).catch((failure) => {
    console.error("[fake-platform]", failure);
    if (!res.headersSent) error(res, 500, "INTERNAL");
  });
}).listen(PORT, () => {
  console.log(`fake platform on http://localhost:${PORT}`);
});
