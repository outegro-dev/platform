/**
 * Hermetic stand-in for the platform during e2e (never used in production).
 * One HTTP server plays every service the console talks to, each under its
 * own path prefix, with deterministic seeded data:
 *
 *   /authorize            identity frontend: a persona picker instead of a login
 *   /auth/...             auth-backend: OAuth token, refresh, logout, /v1/me, admin API
 *   /notifications/...    notifications-backend admin API
 *   /battleship/...       battleship-backend admin API (shape assumed by the adapter)
 *   /payments/...         payments-backend admin API and public catalog
 *   /edu/...              edu-backend admin API (@outegro/contracts/edu)
 *
 * Tokens are unsigned JWT-shaped strings carrying the persona; every admin
 * endpoint checks the persona's permissions like the real services do.
 * Failure injection rides on the browser's User-Agent, which the console
 * forwards to every service: "fake-fail=notifications" answers 503 without
 * a body, "fake-error=edu" answers 503 with the error envelope (the service
 * is up, a dependency of it is not), "fake-down=payments" drops the
 * connection. "fake-assist=off" answers Education's overview with the AI
 * assistant switched off, "fake-assist=paused" with its spending cap for the
 * day reached; "fake-audit=future" adds an Education audit action newer than
 * the contract. "fake-trace=<tag>" keeps every request made with it for
 * GET /__trace/<tag>.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  permissions as allPermissions,
  platformRoles,
} from "@outegro/contracts";
import {
  type AdminOverview,
  setBookAccessSchema,
  setBookStatusSchema,
} from "@outegro/contracts/edu";

const PORT = Number(process.env.FAKE_PLATFORM_PORT ?? 4196);
const NOW = Math.floor(Date.now() / 60_000) * 60_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (at: number) => new Date(at).toISOString();

// ── Deterministic randomness ────────────────────────────────────────────

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = prng(20260929);
const pick = <T>(list: readonly T[]): T =>
  list[Math.floor(random() * list.length)] as T;
const between = (min: number, max: number) =>
  min + Math.floor(random() * (max - min + 1));
function uuidFrom(next: () => number): string {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(next() * 16).toString(16),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[Math.floor(next() * 4)]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function uuid(): string {
  return uuidFrom(random);
}
/** A generator of its own for one record, so every request tells the same story. */
const prngFor = (key: string) =>
  prng(
    [...key].reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      2166136261,
    ),
  );
const maskEmail = (email: string | null) => {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at < 1 ? "***" : `${email[0]}***${email.slice(at)}`;
};

// ── Identity: people, personas, roles ───────────────────────────────────

type Status = "active" | "suspended" | "deleted";
type User = {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  locale: "en" | "ru";
  status: Status;
  version: number;
  createdAt: string;
  sessions: number;
  googleLinked: boolean;
};
type Binding = {
  id: string;
  userId: string;
  role: string;
  scope: string;
  state: "active" | "revoked";
  expiresAt: string | null;
  grantedBy: string | null;
  reason: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
};
type Audit = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  data: Record<string, unknown>;
  requestId: string | null;
  createdAt: string;
};

const personaDefs = {
  owner: {
    name: "Nick Lukashik",
    email: "nick@outegro.dev",
    roles: ["owner"],
    locale: "en" as const,
  },
  support: {
    name: "Sam Carter",
    email: "sam.carter@outegro.dev",
    roles: ["support"],
    locale: "en" as const,
  },
  billing: {
    name: "Bea Novak",
    email: "bea.novak@outegro.dev",
    roles: ["billing_operator"],
    locale: "en" as const,
  },
  auditor: {
    name: "Ada Rossi",
    email: "ada.rossi@outegro.dev",
    roles: ["auditor"],
    locale: "en" as const,
  },
  nobody: {
    name: "Noah Fields",
    email: "noah.fields@example.com",
    roles: [] as string[],
    locale: "en" as const,
  },
  /** Created with the Education seed, after everything else (see there). */
  editor: {
    name: "Elena Sorokina",
    email: "elena.sorokina@outegro.dev",
    roles: ["edu_editor"],
    locale: "en" as const,
  },
};
type Persona = keyof typeof personaDefs;
const personaIds = {} as Record<Persona, string>;

const people: [string | null, string, "en" | "ru"][] = [
  ["Mira Levina", "mira.levina@example.com", "ru"],
  ["Oleg Petrov", "oleg.petrov@example.com", "ru"],
  ["Anna Schmidt", "anna.schmidt@example.de", "en"],
  ["Dmitry Volkov", "d.volkov@example.ru", "ru"],
  ["Lena Park", "lena.park@example.com", "en"],
  [null, "quiet.sailor@example.net", "en"],
  ["Ivan Sokolov", "ivan.sokolov@example.ru", "ru"],
  ["Chloe Martin", "chloe.martin@example.fr", "en"],
  ["Artem Kuznetsov", "artem.k@example.ru", "ru"],
  ["Priya Nair", "priya.nair@example.in", "en"],
  [null, "tidebreaker@example.org", "en"],
  ["Sofia Romanova", "sofia.romanova@example.ru", "ru"],
  ["Lucas Silva", "lucas.silva@example.br", "en"],
  ["Ekaterina Orlova", "k.orlova@example.ru", "ru"],
  ["Tom Becker", "tom.becker@example.de", "en"],
  ["Yuki Tanaka", "yuki.tanaka@example.jp", "en"],
  ["Maxim Fedorov", "max.fedorov@example.ru", "ru"],
  [null, "admiral.nel@example.com", "en"],
  ["Olivia Brown", "olivia.brown@example.co.uk", "en"],
  ["Pavel Egorov", "pavel.egorov@example.ru", "ru"],
  ["Hana Kim", "hana.kim@example.kr", "en"],
  ["Nikita Smirnov", "n.smirnov@example.ru", "ru"],
  ["Emma Wilson", "emma.wilson@example.com", "en"],
  ["Alexei Morozov", "alexei.morozov@example.ru", "ru"],
  [null, "kraken.fan@example.net", "en"],
  ["Julia Hoffmann", "julia.hoffmann@example.de", "en"],
  ["Roman Belov", "roman.belov@example.ru", "ru"],
  ["Grace Lee", "grace.lee@example.com", "en"],
  ["Vera Zaitseva", "vera.z@example.ru", "ru"],
  ["Mateo Garcia", "mateo.garcia@example.es", "en"],
  ["Irina Popova", "irina.popova@example.ru", "ru"],
  ["Ben Carter", "ben.carter@example.com", "en"],
  ["Taisia Lebedeva", "taisia.l@example.ru", "ru"],
  ["Omar Haddad", "omar.haddad@example.com", "en"],
];

const users: User[] = [];
const bindings: Binding[] = [];
const authAudit: Audit[] = [];

function addUser(
  name: string | null,
  email: string,
  locale: "en" | "ru",
  createdAt: number,
  status: Status = "active",
): User {
  const user: User = {
    id: uuid(),
    email,
    emailVerified: random() > 0.12,
    displayName: name,
    locale,
    status,
    version: between(1, 6),
    createdAt: iso(createdAt),
    sessions: status === "active" ? between(0, 4) : 0,
    googleLinked: random() > 0.7,
  };
  users.push(user);
  return user;
}

const ownerCreated = NOW - 58 * DAY;
for (const [key, def] of Object.entries(personaDefs) as [
  Persona,
  (typeof personaDefs)[Persona],
][]) {
  // Drawing from the shared generator here would shift every later seed.
  if (key === "editor") continue;
  const user = addUser(
    def.name,
    def.email,
    def.locale,
    key === "owner" ? ownerCreated : NOW - between(20, 50) * DAY,
  );
  user.emailVerified = true;
  user.sessions = Math.max(1, user.sessions);
  personaIds[key] = user.id;
  for (const role of def.roles) {
    bindings.push({
      id: uuid(),
      userId: user.id,
      role,
      scope: "platform",
      state: "active",
      expiresAt: null,
      grantedBy: key === "owner" ? null : (personaIds.owner ?? null),
      reason:
        key === "owner"
          ? "Initial owner (bootstrap)"
          : `Joined the ${role.replace("_", " ")} rota`,
      createdAt: iso(Date.parse(user.createdAt) + HOUR),
      revokedAt: null,
      revokedBy: null,
    });
  }
}
people.forEach(([name, email, locale], index) => {
  const age =
    index < 6
      ? between(0, 6) * DAY + between(1, 20) * HOUR
      : between(3, 55) * DAY;
  addUser(
    name,
    email,
    locale,
    NOW - age,
    index === 11 || index === 26 ? "suspended" : "active",
  );
});
const userByEmail = (email: string) =>
  users.find((user) => user.email === email) as User;
const mira = userByEmail("mira.levina@example.com");
const oleg = userByEmail("oleg.petrov@example.com");
mira.status = "active";
oleg.status = "active";
oleg.sessions = 3;

// Passkeys (ID-05): Mira has two; Priya's only one is her last way in
// (unverified email, no Google), so support cannot remove it.
type FakePasskey = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  synced: boolean;
  backedUp: boolean;
  usable: boolean;
};
// Fixed ids: uuid() would draw from the seeded generator and shift the
// data generated after this.
const passkeysOf = new Map<string, FakePasskey[]>();
const priya = userByEmail("priya.nair@example.in");
priya.emailVerified = false;
priya.googleLinked = false;
passkeysOf.set(mira.id, [
  {
    id: "7f6b1c2e-1a10-4c3e-9f00-000000000a01",
    name: "MacBook Air",
    createdAt: iso(NOW - 9 * DAY),
    lastUsedAt: iso(NOW - 2 * HOUR),
    synced: true,
    backedUp: true,
    usable: true,
  },
  {
    id: "7f6b1c2e-1a10-4c3e-9f00-000000000a02",
    name: "YubiKey 5C",
    createdAt: iso(NOW - 4 * DAY),
    lastUsedAt: null,
    synced: false,
    backedUp: false,
    usable: true,
  },
]);
passkeysOf.set(priya.id, [
  {
    id: "7f6b1c2e-1a10-4c3e-9f00-000000000a03",
    name: "Pixel 9",
    createdAt: iso(NOW - 6 * DAY),
    lastUsedAt: iso(NOW - DAY),
    synced: true,
    backedUp: true,
    usable: true,
  },
]);

// A past support role that was revoked.
bindings.push({
  id: uuid(),
  userId: userByEmail("anna.schmidt@example.de").id,
  role: "support",
  scope: "platform",
  state: "revoked",
  expiresAt: null,
  grantedBy: personaIds.owner,
  reason: "Covered support during the launch week",
  createdAt: iso(NOW - 30 * DAY),
  revokedAt: iso(NOW - 21 * DAY),
  revokedBy: personaIds.owner,
});

function audit(
  list: Audit[],
  entry: Omit<Audit, "id" | "createdAt" | "requestId"> & { createdAt?: string },
) {
  list.unshift({
    id: uuid(),
    requestId: `req-${randomBytes(4).toString("hex")}`,
    createdAt: entry.createdAt ?? iso(Date.now()),
    ...entry,
  });
}
const seedAudit: [
  number,
  string,
  string,
  string,
  string,
  Record<string, unknown>,
][] = [
  [
    52 * DAY,
    "role.granted",
    personaIds.support,
    "Joined the support rota",
    "support",
    {},
  ],
  [
    51 * DAY,
    "role.granted",
    personaIds.billing,
    "Billing operator for payments launch",
    "billing_operator",
    {},
  ],
  [
    30 * DAY,
    "role.granted",
    userByEmail("anna.schmidt@example.de").id,
    "Covered support during the launch week",
    "support",
    {},
  ],
  [
    21 * DAY,
    "role.revoked",
    userByEmail("anna.schmidt@example.de").id,
    "Launch week is over",
    "support",
    {},
  ],
  [
    9 * DAY,
    "user.suspended",
    userByEmail("sofia.romanova@example.ru").id,
    "Chargeback fraud pattern, see refund case",
    "",
    {},
  ],
  [
    6 * DAY,
    "sessions.revoked",
    userByEmail("lena.park@example.com").id,
    "User reported a lost phone",
    "",
    { count: 2 },
  ],
  [
    2 * DAY,
    "user.suspended",
    userByEmail("roman.belov@example.ru").id,
    "Abusive nickname after two warnings",
    "",
    {},
  ],
  [
    5 * HOUR,
    "sessions.revoked",
    userByEmail("chloe.martin@example.fr").id,
    "Password manager leak reported by the user",
    "",
    { count: 1 },
  ],
];
for (const [ago, action, targetId, reason, role, data] of seedAudit
  .sort((a, b) => a[0] - b[0])
  .reverse()) {
  authAudit.push({
    id: uuid(),
    actorId: personaIds.owner,
    action,
    targetType: "user",
    targetId,
    reason,
    data: role ? { role, ...data } : data,
    requestId: `req-${Math.floor(random() * 1e8).toString(16)}`,
    createdAt: iso(NOW - ago),
  });
}
authAudit.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

// Commercial access as Identity projects it (from Payments).
const identityGrants = new Map<
  string,
  {
    grantId: string;
    service: string;
    feature: string;
    sourceType: string;
    validUntil: string | null;
  }[]
>();

// ── Tokens and sessions ─────────────────────────────────────────────────

type Session = {
  id: string;
  persona: Persona;
  refresh: string;
  previous: string | null;
  previousUntil: number;
};
const sessions = new Map<string, Session>();
const codes = new Map<
  string,
  {
    persona: Persona;
    challenge: string;
    redirectUri: string;
    clientId: string;
    used: boolean;
    until: number;
  }
>();

const b64 = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
function tokensFor(session: Session) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const accessToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: personaIds[session.persona], sid: session.id, persona: session.persona, exp })}.fake`;
  return {
    sessionId: session.id,
    accessToken,
    accessTokenExpiresAt: iso(exp * 1000),
    refreshToken: session.refresh,
    refreshTokenExpiresAt: iso(Date.now() + 30 * DAY),
  };
}
function personaOf(req: IncomingMessage): Persona | null {
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(header.slice(7).split(".")[1] ?? "", "base64url").toString(
        "utf8",
      ),
    );
    if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now())
      return null;
    if (!sessions.has(payload.sid)) return null;
    return payload.persona as Persona;
  } catch {
    return null;
  }
}
function permissionsOf(persona: Persona): string[] {
  const user = users.find((item) => item.id === personaIds[persona]);
  if (user?.status !== "active") return [];
  const roles = bindings
    .filter((b) => b.userId === user.id && b.state === "active")
    .map((b) => b.role);
  const granted = new Set<string>();
  for (const role of roles)
    for (const permission of (
      platformRoles as Record<string, readonly string[]>
    )[role] ?? [])
      granted.add(permission);
  if (roles.includes("owner")) {
    for (const permission of allPermissions) granted.add(permission);
    granted.add("grants.assign");
  }
  return [...granted].sort();
}
const rolesOf = (userId: string) =>
  [
    ...new Set(
      bindings
        .filter((b) => b.userId === userId && b.state === "active")
        .map((b) => b.role),
    ),
  ].sort();

// ── Notifications ───────────────────────────────────────────────────────

type DeliveryState =
  | "pending"
  | "leased"
  | "accepted"
  | "delivered"
  | "retry_wait"
  | "failed"
  | "expired"
  | "unknown";
type Delivery = {
  id: string;
  userId: string;
  channel: "email" | "telegram";
  state: DeliveryState;
  attempts: number;
  templateKey: string;
  category: string;
  title: string;
  lastError: string | null;
  providerMessageId: string | null;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  intent: {
    id: string;
    producer: string;
    sourceEventId: string;
    locale: "en" | "ru";
    data: Record<string, unknown>;
    expiresAt: string;
    createdAt: string;
  };
};
const templates = [
  {
    key: "auth.login-code",
    category: "auth",
    channels: ["email"],
    mandatory: ["email"],
    ttlMs: 10 * MINUTE,
    producer: "identity",
  },
  {
    key: "security.session-revoked",
    category: "security",
    channels: ["inbox", "email", "telegram"],
    mandatory: ["inbox", "email"],
    ttlMs: DAY,
    producer: "identity",
  },
  {
    key: "service.message",
    category: "service",
    channels: ["inbox", "email"],
    mandatory: ["inbox"],
    ttlMs: 3 * DAY,
    producer: "admin",
  },
  {
    key: "service.test",
    category: "service",
    channels: ["email", "telegram"],
    mandatory: [],
    ttlMs: HOUR,
    producer: "admin",
  },
  {
    key: "billing.payment-confirmed",
    category: "billing",
    channels: ["inbox", "email", "telegram"],
    mandatory: ["inbox"],
    ttlMs: 3 * DAY,
    producer: "payments",
  },
];
const titles: Record<string, { en: string; ru: string }> = {
  "auth.login-code": { en: "Sign-in code", ru: "Код входа" },
  "security.session-revoked": { en: "Session ended", ru: "Сеанс завершён" },
  "service.message": { en: "Scheduled maintenance", ru: "Плановые работы" },
  "service.test": { en: "Channel check", ru: "Проверка канала" },
  "billing.payment-confirmed": {
    en: "Payment received",
    ru: "Оплата получена",
  },
};
const deliveries: Delivery[] = [];
const notificationAudit: Audit[] = [];
const noRecipient = new Set<string>();
let channelSettings = {
  version: 3,
  channels: { email: { enabled: true }, telegram: { enabled: true } },
  updatedAt: iso(NOW - 4 * DAY),
  updatedBy: personaIds.owner as string | null,
};

const errorsByChannel = {
  email: [
    "SMTP 550 5.1.1: mailbox unavailable",
    "SMTP 421: service not available, try later",
    "Recipient address rejected: domain has no MX",
  ],
  telegram: [
    "Telegram 403: bot was blocked by the user",
    "Telegram 400: chat not found",
    "Telegram 429: too many requests",
  ],
};
function addDelivery(options: {
  user: User;
  template: (typeof templates)[number];
  channel: "email" | "telegram";
  state: DeliveryState;
  createdAt: number;
}) {
  const { user, template, channel, state, createdAt } = options;
  const locale = user.locale;
  const data: Record<string, unknown> =
    template.key === "auth.login-code"
      ? { code: "[redacted]", minutes: 10 }
      : template.key === "billing.payment-confirmed"
        ? {
            product: "Battleship Premium",
            amount: pick(["50 ₽", "0.59 $", "0.52 €"]),
          }
        : template.key === "security.session-revoked"
          ? { ip: "[redacted]" }
          : template.key === "service.test"
            ? { channel }
            : {
                title: "Scheduled maintenance",
                body: "outegro.dev will be read-only for ten minutes tonight at 23:00 UTC.",
              };
  const failing =
    state === "failed" || state === "unknown" || state === "retry_wait";
  const delivery: Delivery = {
    id: uuid(),
    userId: user.id,
    channel,
    state,
    attempts: state === "pending" ? 0 : failing ? between(2, 5) : 1,
    templateKey: template.key,
    category: template.category,
    title: titles[template.key]?.[locale] ?? template.key,
    lastError:
      state === "unknown"
        ? "Provider timed out after accepting the request"
        : failing
          ? pick(errorsByChannel[channel])
          : null,
    providerMessageId:
      state === "delivered" || state === "accepted" || state === "unknown"
        ? `msg_${randomBytes(6).toString("hex")}`
        : null,
    nextAttemptAt: iso(
      state === "retry_wait" ? Date.now() + 4 * MINUTE : createdAt,
    ),
    createdAt: iso(createdAt),
    updatedAt: iso(createdAt + between(1, 40) * 1000),
    intent: {
      id: uuid(),
      producer: template.producer,
      sourceEventId: uuid(),
      locale,
      data,
      expiresAt: iso(createdAt + template.ttlMs),
      createdAt: iso(createdAt - 800),
    },
  };
  deliveries.push(delivery);
  return delivery;
}
const activeUsers = users.filter((user) => user.status === "active");
for (let index = 0; index < 64; index++) {
  const template = pick(templates);
  const channel =
    template.channels.includes("telegram") && random() > 0.55
      ? "telegram"
      : "email";
  const createdAt = NOW - Math.floor(random() * 7 * DAY);
  const roll = random();
  const state: DeliveryState =
    roll < 0.66
      ? "delivered"
      : roll < 0.8
        ? "accepted"
        : roll < 0.9
          ? "failed"
          : roll < 0.95
            ? "expired"
            : "unknown";
  addDelivery({ user: pick(activeUsers), template, channel, state, createdAt });
}
// Named deliveries the tests use.
const billingTemplate = templates[4] as (typeof templates)[number];
const failedDelivery = addDelivery({
  user: mira,
  template: billingTemplate,
  channel: "email",
  state: "failed",
  createdAt: NOW - 3 * HOUR,
});
failedDelivery.lastError = "SMTP 421: service not available, try later";
addDelivery({
  user: oleg,
  template: billingTemplate,
  channel: "telegram",
  state: "unknown",
  createdAt: NOW - 2 * HOUR,
});
addDelivery({
  user: mira,
  template: templates[1] as (typeof templates)[number],
  channel: "telegram",
  state: "failed",
  createdAt: NOW - 5 * HOUR,
});
addDelivery({
  user: userByEmail("lena.park@example.com"),
  template: templates[0] as (typeof templates)[number],
  channel: "email",
  state: "failed",
  createdAt: NOW - 50 * MINUTE,
});
addDelivery({
  user: userByEmail("tom.becker@example.de"),
  template: templates[2] as (typeof templates)[number],
  channel: "email",
  state: "retry_wait",
  createdAt: NOW - 25 * MINUTE,
});
addDelivery({
  user: userByEmail("yuki.tanaka@example.jp"),
  template: templates[2] as (typeof templates)[number],
  channel: "email",
  state: "pending",
  createdAt: NOW - 18 * MINUTE,
});
deliveries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
noRecipient.add(userByEmail("omar.haddad@example.com").id);
audit(notificationAudit, {
  actorId: personaIds.owner,
  action: "settings.channels.update",
  targetType: "settings",
  targetId: "channels",
  reason: "Telegram rate limits during the bot migration",
  data: {
    before: { telegram: { enabled: true } },
    after: { telegram: { enabled: false } },
  },
  createdAt: iso(NOW - 4 * DAY - 2 * HOUR),
});
audit(notificationAudit, {
  actorId: personaIds.owner,
  action: "settings.channels.update",
  targetType: "settings",
  targetId: "channels",
  reason: "Migration finished, limits are back to normal",
  data: {
    before: { telegram: { enabled: false } },
    after: { telegram: { enabled: true } },
  },
  createdAt: iso(NOW - 4 * DAY),
});
audit(notificationAudit, {
  actorId: personaIds.support,
  action: "delivery.retry",
  targetType: "delivery",
  targetId: (deliveries[20] as Delivery).id,
  reason: "User asked for the receipt again after the SMTP outage",
  data: { previousState: "failed", previousAttempts: 5 },
  createdAt: iso(NOW - DAY - 3 * HOUR),
});

function renderEmail(key: string, locale: "en" | "ru") {
  const title = titles[key]?.[locale] ?? key;
  const body: Record<string, { en: string; ru: string }> = {
    "auth.login-code": {
      en: "Enter this code on the sign-in page. Never share it with anyone.",
      ru: "Введите этот код на странице входа. Никому его не сообщайте.",
    },
    "security.session-revoked": {
      en: "We saw a session token being reused and ended that session (IP 203.0.113.7). If this was not you, sign in again and end your other sessions.",
      ru: "Мы заметили повторное использование токена сеанса и завершили его (IP 203.0.113.7). Если это были не вы, войдите заново и завершите остальные сеансы.",
    },
    "service.message": {
      en: "outegro.dev will be read-only for ten minutes tonight at 23:00 UTC.",
      ru: "outegro.dev будет доступен только для чтения десять минут сегодня в 23:00 UTC.",
    },
    "service.test": {
      en: "A test message from the admin console (email). If you can read it, the channel works.",
      ru: "Тестовое сообщение из админки (email). Если вы его видите, канал работает.",
    },
    "billing.payment-confirmed": {
      en: "We received 50 ₽ for “Battleship Premium”. Your access is active.",
      ru: "Мы получили оплату 50 ₽ за «Морской бой Premium». Доступ уже открыт.",
    },
  };
  const subject: Record<string, { en: string; ru: string }> = {
    "auth.login-code": {
      en: "Your sign-in code: 482913",
      ru: "Код входа: 482913",
    },
    "security.session-revoked": {
      en: "A session was ended for your security",
      ru: "Сеанс завершён из соображений безопасности",
    },
    "service.message": { en: "Scheduled maintenance", ru: "Плановые работы" },
    "service.test": {
      en: "outegro.dev channel check",
      ru: "Проверка канала outegro.dev",
    },
    "billing.payment-confirmed": {
      en: "Payment received: Battleship Premium",
      ru: "Оплата получена: Морской бой Premium",
    },
  };
  const text = body[key]?.[locale] ?? "";
  const code =
    key === "auth.login-code"
      ? `<p style="font-size:34px;letter-spacing:10px;font-weight:700;margin:20px 0">482913</p>`
      : "";
  const html = `<!DOCTYPE html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background-color:#f2f2ef;font-family:Manrope,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#171817"><div style="max-width:520px;margin:0 auto;padding:40px 20px"><p style="font-size:18px;font-weight:700;letter-spacing:-0.04em;margin:0 0 28px">Nick Lukashik</p><div style="background-color:#fafaf7;border:1px solid #c7c9c2;border-radius:20px;padding:32px 28px"><p style="font-size:24px;line-height:30px;font-weight:700;letter-spacing:-0.03em;margin:0 0 12px">${title}</p><p style="font-size:15px;line-height:24px;color:#5b5d58;margin:0">${text}</p>${code}</div><hr style="border:none;border-top:1px solid #c7c9c2;margin:28px 0 16px"><p style="font-size:12px;line-height:18px;color:#5b5d58;margin:0">${locale === "ru" ? "Вы получили это письмо, потому что у вас есть аккаунт на" : "You receive this because you have an account at"} <a href="https://outegro.dev" style="color:#5b5d58">outegro.dev</a></p></div></body></html>`;
  return {
    subject: subject[key]?.[locale] ?? title,
    text: key === "auth.login-code" ? `${title}: 482913` : text,
    html,
  };
}

// ── Battleship ──────────────────────────────────────────────────────────

type Ship = {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
};
type Move = {
  n: number;
  side: "a" | "b";
  x: number | null;
  y: number | null;
  outcome: "miss" | "hit" | "sunk" | "skip";
  at: string;
};
type Player = {
  userId: string;
  nickname: string;
  rating: number;
  ratedMatches: number;
  matches: number;
  wins: number;
  losses: number;
  status: Status;
  leaderboardHidden: boolean;
  online: boolean;
  createdAt: string;
  premium: boolean;
};
type Match = {
  matchId: string;
  mode: "bot" | "quick" | "private";
  status: "placement" | "battle" | "finished" | "aborted";
  a: string;
  b: string | null;
  botLevel: "easy" | "medium" | "hard" | "expert" | null;
  winner: "a" | "b" | null;
  reason: string | null;
  abortReason: string | null;
  rated: boolean;
  ratingDelta: number | null;
  createdAt: string;
  battleStartedAt: string | null;
  finishedAt: string | null;
  firstTurn: "a" | "b";
  fleets: { a: Ship[] | null; b: Ship[] | null };
  moves: Move[];
};

function placeFleet(): Ship[] {
  const lengths = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
  for (let attempt = 0; attempt < 200; attempt++) {
    const taken = new Set<string>();
    const fleet: Ship[] = [];
    let ok = true;
    for (const length of lengths) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const orientation = random() > 0.5 ? "horizontal" : "vertical";
        const x = between(0, orientation === "horizontal" ? 10 - length : 9);
        const y = between(0, orientation === "vertical" ? 10 - length : 9);
        const cells = Array.from({ length }, (_, i) =>
          orientation === "horizontal" ? [x + i, y] : [x, y + i],
        );
        const free = cells.every(([cx, cy]) => {
          for (let dx = -1; dx <= 1; dx++)
            for (let dy = -1; dy <= 1; dy++)
              if (taken.has(`${(cx as number) + dx},${(cy as number) + dy}`))
                return false;
          return true;
        });
        if (free) {
          for (const [cx, cy] of cells) taken.add(`${cx},${cy}`);
          fleet.push({ x, y, length, orientation });
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet;
  }
  throw new Error("could not place a fleet");
}
const cellsOf = (ship: Ship) =>
  Array.from({ length: ship.length }, (_, i) =>
    ship.orientation === "horizontal"
      ? { x: ship.x + i, y: ship.y }
      : { x: ship.x, y: ship.y + i },
  );

/** Plays shots until one fleet is gone (or `limit` moves); a hit keeps the turn. */
function simulate(
  fleets: { a: Ship[]; b: Ship[] },
  firstTurn: "a" | "b",
  start: number,
  limit = 400,
  skill = { a: 0.35, b: 0.35 },
) {
  const moves: Move[] = [];
  const shots = { a: new Set<string>(), b: new Set<string>() };
  const hits = { a: new Set<string>(), b: new Set<string>() };
  let turn = firstTurn;
  let at = start;
  let winner: "a" | "b" | null = null;
  const target = (side: "a" | "b") => (side === "a" ? fleets.b : fleets.a);
  while (moves.length < limit) {
    const enemy = target(turn);
    const enemyCells = enemy.flatMap(cellsOf).map((c) => `${c.x},${c.y}`);
    const remaining = enemyCells.filter((key) => !hits[turn].has(key));
    if (remaining.length === 0) {
      winner = turn;
      break;
    }
    let key: string;
    if (random() < skill[turn]) key = pick(remaining);
    else {
      const free: string[] = [];
      for (let x = 0; x < 10; x++)
        for (let y = 0; y < 10; y++)
          if (!shots[turn].has(`${x},${y}`)) free.push(`${x},${y}`);
      key = pick(free);
    }
    shots[turn].add(key);
    const [x, y] = key.split(",").map(Number) as [number, number];
    at += between(4, 22) * 1000;
    const hit = enemyCells.includes(key);
    let outcome: Move["outcome"] = "miss";
    if (hit) {
      hits[turn].add(key);
      const ship = enemy.find((s) =>
        cellsOf(s).some((c) => c.x === x && c.y === y),
      ) as Ship;
      outcome = cellsOf(ship).every((c) => hits[turn].has(`${c.x},${c.y}`))
        ? "sunk"
        : "hit";
    }
    moves.push({ n: moves.length + 1, side: turn, x, y, outcome, at: iso(at) });
    if (!hit) turn = turn === "a" ? "b" : "a";
  }
  return { moves, winner, end: at };
}

const nicknames = [
  "SeaWolf",
  "Kraken",
  "Admiral Nel",
  "Tidebreaker",
  "Morskoy",
  "Quiet Sailor",
  "Nordwind",
  "Coral Queen",
  "Harpoon",
  "Deep Blue",
  "Stormcrow",
  "Lighthouse",
  "Barracuda",
  "Captain Mira",
  "Oleg-the-Bold",
  "Mistral",
  "Grey Frigate",
  "Anchorman",
  "Salty Dog",
  "Periscope",
  "Flagship",
  "Nautilus",
];
const players: Player[] = [];
const playerUsers = users
  .filter(
    (user) =>
      user.id !== personaIds.nobody &&
      user.id !== personaIds.auditor &&
      user.id !== personaIds.billing,
  )
  .slice(0, nicknames.length);
playerUsers.forEach((user, index) => {
  const matches = between(4, 140);
  const wins = Math.floor(matches * (0.3 + random() * 0.45));
  players.push({
    userId: user.id,
    nickname:
      user.id === mira.id
        ? "Captain Mira"
        : user.id === oleg.id
          ? "Oleg-the-Bold"
          : (nicknames[index] as string),
    rating: between(820, 1860),
    ratedMatches: Math.floor(matches * 0.6),
    matches,
    wins,
    losses: matches - wins,
    status: user.status,
    leaderboardHidden: index === 9,
    online: random() > 0.6,
    createdAt: iso(Date.parse(user.createdAt) + between(1, 48) * HOUR),
    premium: random() > 0.6,
  });
});
const playerOf = (userId: string) =>
  players.find((player) => player.userId === userId);
const battleshipAudit: Audit[] = [];
const matches: Match[] = [];
const levels = ["easy", "medium", "hard", "expert"] as const;

function addMatch(options: {
  mode: Match["mode"];
  status: Match["status"];
  createdAt: number;
  a: Player;
  b: Player | null;
  level?: Match["botLevel"];
}) {
  const fleets = { a: placeFleet(), b: placeFleet() };
  const firstTurn = random() > 0.5 ? "a" : "b";
  const battleStart = options.createdAt + between(20, 80) * 1000;
  const live = options.status === "battle";
  const game =
    options.status === "placement"
      ? { moves: [], winner: null, end: battleStart }
      : simulate(fleets, firstTurn, battleStart, live ? between(14, 40) : 400, {
          a: 0.3 + random() * 0.2,
          b: options.b
            ? 0.3 + random() * 0.2
            : 0.22 + levels.indexOf(options.level ?? "easy") * 0.08,
        });
  const rated = options.mode === "quick";
  const match: Match = {
    matchId: uuid(),
    mode: options.mode,
    status: options.status,
    a: options.a.userId,
    b: options.b?.userId ?? null,
    botLevel: options.b ? null : (options.level ?? pick(levels)),
    winner: options.status === "finished" ? game.winner : null,
    reason:
      options.status === "finished"
        ? random() > 0.12
          ? "fleet_destroyed"
          : pick(["resigned", "timeout"])
        : null,
    abortReason:
      options.status === "aborted"
        ? pick(["placement_timeout", "moderation"])
        : null,
    rated,
    ratingDelta: rated && options.status === "finished" ? between(8, 24) : null,
    createdAt: iso(options.createdAt),
    battleStartedAt: options.status === "placement" ? null : iso(battleStart),
    finishedAt:
      options.status === "finished" || options.status === "aborted"
        ? iso(game.end + 1000)
        : null,
    firstTurn,
    fleets: {
      a: fleets.a,
      b: options.status === "placement" ? null : fleets.b,
    },
    moves: options.status === "aborted" ? game.moves.slice(0, 12) : game.moves,
  };
  matches.push(match);
  return match;
}
for (let index = 0; index < 26; index++) {
  const mode = pick(["bot", "bot", "quick", "quick", "private"] as const);
  const a = pick(players);
  const b = mode === "bot" ? null : pick(players.filter((p) => p !== a));
  addMatch({
    mode,
    status: index === 7 || index === 15 ? "aborted" : "finished",
    createdAt: NOW - between(1, 6 * 24) * HOUR,
    a,
    b,
  });
}
const liveMatch = addMatch({
  mode: "quick",
  status: "battle",
  createdAt: NOW - 9 * MINUTE,
  a: playerOf(mira.id) as Player,
  b: playerOf(oleg.id) as Player,
});
addMatch({
  mode: "bot",
  status: "battle",
  createdAt: NOW - 6 * MINUTE,
  a: players[3] as Player,
  b: null,
  level: "hard",
});
addMatch({
  mode: "private",
  status: "battle",
  createdAt: NOW - 4 * MINUTE,
  a: players[5] as Player,
  b: players[8] as Player,
});
addMatch({
  mode: "quick",
  status: "placement",
  createdAt: NOW - MINUTE,
  a: players[10] as Player,
  b: players[12] as Player,
});
/**
 * Lost on the placement clock: side a placed a fleet, side b did not, and
 * the battle never started. The server calls it `timeout`, like a timeout
 * in battle, with no battleStartedAt. Built without the shared generator so
 * the rest of the seed stays the same; it lists right after the newest
 * finished match.
 */
const newestFinished = Math.max(
  ...matches
    .filter((m) => m.status === "finished")
    .map((m) => Date.parse(m.createdAt)),
);
const notDeployedAt = newestFinished - MINUTE;
matches.push({
  matchId: uuidFrom(prngFor("not-deployed")),
  mode: "private",
  status: "finished",
  a: mira.id,
  b: (players.find((p) => p.nickname === "Nordwind") as Player).userId,
  botLevel: null,
  winner: "a",
  reason: "timeout",
  abortReason: null,
  rated: false,
  ratingDelta: null,
  createdAt: iso(notDeployedAt),
  battleStartedAt: null,
  finishedAt: iso(notDeployedAt + 90_000),
  firstTurn: "a",
  fleets: {
    a: [
      { x: 0, y: 0, length: 4, orientation: "horizontal" },
      { x: 5, y: 0, length: 3, orientation: "horizontal" },
      { x: 0, y: 2, length: 3, orientation: "horizontal" },
      { x: 4, y: 2, length: 2, orientation: "horizontal" },
      { x: 7, y: 2, length: 2, orientation: "horizontal" },
      { x: 0, y: 4, length: 2, orientation: "horizontal" },
      { x: 3, y: 4, length: 1, orientation: "horizontal" },
      { x: 5, y: 4, length: 1, orientation: "horizontal" },
      { x: 7, y: 4, length: 1, orientation: "horizontal" },
      { x: 9, y: 4, length: 1, orientation: "horizontal" },
    ],
    b: null,
  },
  moves: [],
});
matches.sort((m1, m2) => (m1.createdAt < m2.createdAt ? 1 : -1));
audit(battleshipAudit, {
  actorId: personaIds.support,
  action: "player.nickname.reset",
  targetType: "player",
  targetId: (players[14] as Player).userId,
  reason: "Nickname impersonated a moderator",
  data: { previous: "Official-Admin", next: (players[14] as Player).nickname },
  createdAt: iso(NOW - 3 * DAY),
});
audit(battleshipAudit, {
  actorId: personaIds.owner,
  action: "player.leaderboard.hidden",
  targetType: "player",
  targetId: (players[9] as Player).userId,
  reason: "Win trading with a second account, under review",
  data: {},
  createdAt: iso(NOW - 2 * DAY),
});
const abortedByModerator = matches.find(
  (match) => match.abortReason === "moderation",
);
if (abortedByModerator)
  audit(battleshipAudit, {
    actorId: personaIds.support,
    action: "match.aborted",
    targetType: "match",
    targetId: abortedByModerator.matchId,
    reason: "Stuck match after the deploy, players asked to restart",
    data: {},
    createdAt: abortedByModerator.finishedAt ?? iso(NOW - DAY),
  });

// ── Payments ────────────────────────────────────────────────────────────

type Money = { minor: string; currency: string; scale: number };
const prices = { RUB: 5000n, USD: 59n, EUR: 52n } as const;
type Currency = keyof typeof prices;
const money = (minor: bigint, currency: string): Money => ({
  minor: minor.toString(),
  currency,
  scale: 2,
});
const products = [
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
  },
] as const;
type PayGrant = {
  id: string;
  userId: string;
  service: string;
  feature: string;
  sourceType: "purchase" | "subscription" | "manual";
  sourceId: string;
  state: "active" | "revoked" | "expired";
  validFrom: string;
  validUntil: string | null;
  version: number;
  reason: string | null;
  grantedBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
};
type Order = {
  id: string;
  userId: string;
  productKey: string;
  kind: string;
  status: "pending" | "paid" | "failed" | "refunded";
  currency: Currency;
  amount: bigint;
  createdAt: string;
  paidAt: string | null;
  correlationId: string;
  attempt: {
    id: string;
    state: string;
    providerInvoiceId: string | null;
    failureReason: string | null;
    checks: number;
    nextCheckAt: string | null;
    requestedAt: string;
    resolvedAt: string | null;
  };
  subscriptionId: string | null;
};
type Payment = {
  id: string;
  orderId: string;
  subscriptionId: string | null;
  userId: string;
  kind: string;
  state: "confirmed" | "refunded" | "disputed";
  currency: Currency;
  amount: bigint;
  providerContractId: string;
  paidAt: string;
  confirmedAt: string;
};
type Subscription = {
  id: string;
  orderId: string;
  productKey: string;
  state: string;
  autoRenew: boolean;
  paidUntil: string;
  graceDays: number;
  currency: Currency;
  amount: bigint;
  periodicity: string;
  cancelRequestedAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  userId: string;
  providerStatus: string;
};
type ProviderEvent = {
  id: string;
  source: string;
  type: string;
  rawType: string | null;
  status: string;
  note: string | null;
  contractId: string | null;
  parentContractId: string | null;
  orderId: string | null;
  subscriptionId: string | null;
  paymentId: string | null;
  refundId: string | null;
  attempts: number;
  lastError: string | null;
  payloadHash: string;
  receivedAt: string;
  processedAt: string | null;
  payload: unknown;
  fact: unknown;
};
type Refund = {
  id: string;
  kind: string;
  state: string;
  providerRef: string | null;
  paymentId: string | null;
  userId: string | null;
  refundType: string | null;
  currency: Currency | null;
  amount: bigint | null;
  reason: string | null;
  evidence: unknown;
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
};
type Issue = {
  id: string;
  kind: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved";
  subjectKey: string;
  related: unknown;
  evidence: unknown;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

const orders: Order[] = [];
const payments: Payment[] = [];
const subscriptions: Subscription[] = [];
const events: ProviderEvent[] = [];
const refunds: Refund[] = [];
const issues: Issue[] = [];
const payGrants: PayGrant[] = [];
const paymentsAudit: (Audit & { targetType: string })[] = [];
const contract = () => `lava_${randomBytes(5).toString("hex")}`;
const hash = () => randomBytes(16).toString("hex");

function addEvent(
  event: Omit<Partial<ProviderEvent>, "receivedAt"> & {
    type: string;
    status: string;
    receivedAt: number;
  },
): ProviderEvent {
  const full: ProviderEvent = {
    id: uuid(),
    source: "webhook",
    rawType:
      event.type === "payment.confirmed"
        ? "payment.success"
        : event.type === "subscription.renewed"
          ? "subscription.recurring.payment.success"
          : null,
    note: null,
    contractId: null,
    parentContractId: null,
    orderId: null,
    subscriptionId: null,
    paymentId: null,
    refundId: null,
    attempts: 1,
    lastError: null,
    payloadHash: hash(),
    processedAt: iso(event.receivedAt + 900),
    payload: null,
    fact: null,
    ...event,
    receivedAt: iso(event.receivedAt),
  };
  events.push(full);
  return full;
}
function grantFor(
  order: Order,
  sourceType: "purchase" | "subscription",
  sourceId: string,
  validUntil: string | null,
  state: PayGrant["state"] = "active",
): PayGrant {
  const product = products.find(
    (p) => p.key === order.productKey,
  ) as (typeof products)[number];
  const grant: PayGrant = {
    id: uuid(),
    userId: order.userId,
    service: product.service,
    feature: product.feature,
    sourceType,
    sourceId,
    state,
    validFrom: order.paidAt ?? order.createdAt,
    validUntil,
    version: 1,
    reason: null,
    grantedBy: null,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  payGrants.push(grant);
  return grant;
}

const buyers = activeUsers.filter(
  (user) => !Object.values(personaIds).includes(user.id),
);
for (let index = 0; index < 40; index++) {
  const product = random() > 0.45 ? products[0] : products[1];
  const currency = pick(["RUB", "RUB", "RUB", "USD", "EUR"] as const);
  const buyer = index === 0 ? mira : index === 1 ? oleg : pick(buyers);
  const createdAt = NOW - between(1, 29 * 24) * HOUR - between(0, 59) * MINUTE;
  const roll = random();
  const status: Order["status"] =
    index < 2
      ? "paid"
      : roll < 0.74
        ? "paid"
        : roll < 0.84
          ? "failed"
          : roll < 0.93
            ? "pending"
            : "refunded";
  const paid = status === "paid" || status === "refunded";
  const invoice = `inv_${randomBytes(5).toString("hex")}`;
  const order: Order = {
    id: uuid(),
    userId: buyer.id,
    productKey: product.key,
    kind: product.kind,
    status,
    currency,
    amount: prices[currency],
    createdAt: iso(createdAt),
    paidAt: paid ? iso(createdAt + between(40, 400) * 1000) : null,
    correlationId: uuid(),
    attempt: {
      id: uuid(),
      state:
        status === "failed"
          ? "failed"
          : status === "pending"
            ? random() > 0.5
              ? "ready"
              : "unknown"
            : "ready",
      providerInvoiceId: invoice,
      failureReason:
        status === "failed"
          ? pick([
              "Card declined by the issuer",
              "3-D Secure was not completed",
              "Payment page expired",
            ])
          : null,
      checks: status === "pending" ? between(1, 6) : between(0, 2),
      nextCheckAt: status === "pending" ? iso(Date.now() + 5 * MINUTE) : null,
      requestedAt: iso(createdAt + 1200),
      // The provider answers the checkout call within seconds.
      resolvedAt:
        status === "pending"
          ? null
          : iso(createdAt + 1200 + between(2, 6) * 1000),
    },
    subscriptionId: null,
  };
  orders.push(order);
  addEvent({
    type: "invoice.created",
    status: "processed",
    contractId: invoice,
    orderId: order.id,
    receivedAt: createdAt + 2000,
    source: "webhook",
    payload: {
      invoiceId: invoice,
      buyer: { email: buyer.email },
      amount: Number(order.amount) / 100,
      currency,
    },
  });
  if (status === "failed")
    addEvent({
      type: "payment.failed",
      status: "processed",
      contractId: invoice,
      orderId: order.id,
      receivedAt: createdAt + 300_000,
      payload: {
        contractId: invoice,
        status: "failed",
        buyer: { email: buyer.email },
      },
    });
  if (!paid) continue;
  const paidAt = Date.parse(order.paidAt as string);
  const contractId = contract();
  const payment: Payment = {
    id: uuid(),
    orderId: order.id,
    subscriptionId: null,
    userId: buyer.id,
    kind: product.kind === "subscription" ? "subscription_initial" : "purchase",
    state: status === "refunded" ? "refunded" : "confirmed",
    currency,
    amount: order.amount,
    providerContractId: contractId,
    paidAt: iso(paidAt),
    confirmedAt: iso(paidAt + between(2, 30) * 1000),
  };
  payments.push(payment);
  const confirmed = addEvent({
    type: "payment.confirmed",
    status: "processed",
    contractId,
    parentContractId: invoice,
    orderId: order.id,
    paymentId: payment.id,
    receivedAt: paidAt + 4000,
    payload: {
      contractId,
      parentContractId: invoice,
      status: "success",
      amount: Number(order.amount) / 100,
      currency,
      buyer: { email: buyer.email },
    },
    fact: {
      kind: "payment",
      contractId,
      amountMinor: order.amount.toString(),
      currency,
    },
  });
  if (product.kind === "subscription") {
    const monthsPaid = Math.max(1, Math.floor((NOW - paidAt) / (30 * DAY)) + 1);
    const state =
      index === 0
        ? "active"
        : pick([
            "active",
            "active",
            "active",
            "past_due",
            "cancel_requested",
            "cancel_requested",
          ]);
    const paidUntil = paidAt + monthsPaid * 30 * DAY;
    const subscription: Subscription = {
      id: uuid(),
      orderId: order.id,
      productKey: product.key,
      state,
      autoRenew: state === "active" || state === "past_due",
      paidUntil: iso(paidUntil),
      graceDays: 3,
      currency,
      amount: order.amount,
      periodicity: "MONTHLY",
      // Some time after the payment (one draw, as before).
      cancelRequestedAt:
        state === "cancel_requested"
          ? iso(paidAt + Math.floor(((NOW - paidAt) * between(4, 9)) / 10))
          : null,
      cancelledAt: null,
      expiredAt: null,
      createdAt: iso(paidAt + 5000),
      userId: buyer.id,
      providerStatus: state === "past_due" ? "PAYMENT_FAILED" : "ACTIVE",
    };
    subscriptions.push(subscription);
    order.subscriptionId = subscription.id;
    payment.subscriptionId = subscription.id;
    confirmed.subscriptionId = subscription.id;
    grantFor(
      order,
      "subscription",
      subscription.id,
      iso(paidUntil + 3 * DAY),
      "active",
    );
    if (state === "past_due")
      addEvent({
        type: "subscription.renewal_failed",
        status: "processed",
        contractId: contract(),
        parentContractId: contractId,
        orderId: order.id,
        subscriptionId: subscription.id,
        receivedAt: NOW - between(1, 3) * DAY,
        payload: {
          status: "failed",
          reason: "insufficient funds",
          buyer: { email: buyer.email },
        },
      });
  } else {
    grantFor(
      order,
      "purchase",
      order.id,
      null,
      status === "refunded" ? "revoked" : "active",
    );
  }
  if (status === "refunded") {
    const refund: Refund = {
      id: uuid(),
      kind: "refund",
      state: "recorded",
      providerRef: `rf_${randomBytes(4).toString("hex")}`,
      paymentId: payment.id,
      userId: buyer.id,
      refundType: "full",
      currency,
      amount: order.amount,
      reason: "Bought by mistake, asked within a day",
      evidence: { contractId, matchedBy: "contract" },
      requestedBy: personaIds.billing,
      createdAt: iso(paidAt + DAY),
      updatedAt: iso(paidAt + DAY + HOUR),
    };
    refunds.push(refund);
    addEvent({
      type: "refund.completed",
      status: "processed",
      contractId,
      orderId: order.id,
      paymentId: payment.id,
      refundId: refund.id,
      receivedAt: paidAt + DAY + HOUR,
      payload: {
        contractId,
        refundId: refund.providerRef,
        status: "completed",
      },
    });
    paymentsAudit.push({
      id: uuid(),
      actorId: personaIds.billing,
      action: "refund.requested",
      targetType: "payment",
      targetId: payment.id,
      reason: refund.reason,
      data: {},
      requestId: null,
      createdAt: iso(paidAt + DAY),
    });
  }
}
orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
// Oleg's order has an extra renewal payment, for a richer timeline.
{
  const order = orders.find((o) => o.userId === oleg.id && o.status === "paid");
  if (order?.subscriptionId) {
    const renewalAt = Date.parse(order.paidAt as string) + 30 * DAY;
    if (renewalAt < NOW) {
      payments.push({
        id: uuid(),
        orderId: order.id,
        subscriptionId: order.subscriptionId,
        userId: oleg.id,
        kind: "subscription_renewal",
        state: "confirmed",
        currency: order.currency,
        amount: order.amount,
        providerContractId: contract(),
        paidAt: iso(renewalAt),
        confirmedAt: iso(renewalAt + 3000),
      });
    }
  }
}
// Manual grant with a reason.
payGrants.push({
  id: uuid(),
  userId: userByEmail("lena.park@example.com").id,
  service: "battleship",
  feature: "premium",
  sourceType: "manual",
  sourceId: uuid(),
  state: "active",
  validFrom: iso(NOW - 6 * DAY),
  validUntil: iso(NOW + 24 * DAY),
  version: 1,
  reason: "Compensation for the lost-phone lockout",
  grantedBy: personaIds.owner,
  revokedAt: null,
  revokedBy: null,
  revokeReason: null,
});
paymentsAudit.push({
  id: uuid(),
  actorId: personaIds.owner,
  action: "grant.created",
  targetType: "grant",
  targetId: (payGrants.at(-1) as PayGrant).id,
  reason: "Compensation for the lost-phone lockout",
  data: {},
  requestId: null,
  createdAt: iso(NOW - 6 * DAY),
});
// Troubles for the reconciliation pages.
const orphanContract = contract();
const unmatched = addEvent({
  type: "refund.completed",
  status: "unmatched",
  contractId: orphanContract,
  receivedAt: NOW - 7 * HOUR,
  processedAt: null,
  attempts: 3,
  note: "No payment with this contract yet",
  payload: {
    contractId: orphanContract,
    refundId: "rf_unknown",
    amount: 0.59,
    currency: "USD",
    buyer: { email: "kraken.fan@example.net" },
  },
});
addEvent({
  type: "payment.confirmed",
  status: "mismatch",
  contractId: contract(),
  receivedAt: NOW - 30 * HOUR,
  note: "Amount 45.00 RUB differs from the order's 50.00 RUB",
  payload: {
    amount: 45,
    currency: "RUB",
    buyer: { email: "pavel.egorov@example.ru" },
  },
});
addEvent({
  type: "subscription.renewed",
  status: "failed",
  contractId: contract(),
  receivedAt: NOW - 90 * MINUTE,
  processedAt: null,
  attempts: 4,
  lastError: "Deadlock detected while applying the period; will retry",
  payload: { status: "success" },
});
events.sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
refunds.push({
  id: uuid(),
  kind: "refund",
  state: "unmatched",
  providerRef: "rf_unknown",
  paymentId: null,
  userId: null,
  refundType: "full",
  currency: "USD",
  amount: 59n,
  reason: null,
  evidence: {
    contractId: orphanContract,
    providerEmail: "kraken.fan@example.net",
  },
  requestedBy: null,
  createdAt: iso(NOW - 7 * HOUR),
  updatedAt: iso(NOW - 7 * HOUR),
});
refunds.push({
  id: uuid(),
  kind: "refund",
  state: "review_required",
  providerRef: `rf_${randomBytes(4).toString("hex")}`,
  paymentId: null,
  userId: userByEmail("grace.lee@example.com").id,
  refundType: "partial",
  currency: "EUR",
  amount: 26n,
  reason: null,
  evidence: { note: "Partial refund on a one-time purchase" },
  requestedBy: null,
  createdAt: iso(NOW - 2 * DAY),
  updatedAt: iso(NOW - 2 * DAY),
});
refunds.push({
  id: uuid(),
  kind: "chargeback",
  state: "open",
  providerRef: `cb_${randomBytes(4).toString("hex")}`,
  paymentId: (payments[3] as Payment).id,
  userId: (payments[3] as Payment).userId,
  refundType: null,
  currency: (payments[3] as Payment).currency,
  amount: (payments[3] as Payment).amount,
  reason: "Cardholder does not recognise the charge",
  evidence: { issuer: "Visa", code: "10.4" },
  requestedBy: null,
  createdAt: iso(NOW - 3 * DAY),
  updatedAt: iso(NOW - 3 * DAY),
});
refunds.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
issues.push({
  id: uuid(),
  kind: "payment_without_order",
  severity: "high",
  status: "open",
  subjectKey: `contract:${orphanContract}`,
  related: { eventId: unmatched.id, contractId: orphanContract },
  evidence: { amount: "0.59", currency: "USD", seenIn: "refund.completed" },
  occurrences: 3,
  firstSeenAt: iso(NOW - 7 * HOUR),
  lastSeenAt: iso(NOW - 40 * MINUTE),
  resolvedAt: null,
  resolution: null,
});
issues.push({
  id: uuid(),
  kind: "amount_mismatch",
  severity: "medium",
  status: "open",
  subjectKey: "order:mismatch-45-rub",
  related: {},
  evidence: { expected: "50.00 RUB", received: "45.00 RUB" },
  occurrences: 1,
  firstSeenAt: iso(NOW - 30 * HOUR),
  lastSeenAt: iso(NOW - 30 * HOUR),
  resolvedAt: null,
  resolution: null,
});
issues.push({
  id: uuid(),
  kind: "stale_checkout",
  severity: "low",
  status: "open",
  subjectKey: "attempt:stale",
  related: {},
  evidence: { checks: 6, lastStatus: "unknown" },
  occurrences: 6,
  firstSeenAt: iso(NOW - 2 * DAY),
  lastSeenAt: iso(NOW - 3 * HOUR),
  resolvedAt: null,
  resolution: null,
});
issues.push({
  id: uuid(),
  kind: "duplicate_webhook",
  severity: "low",
  status: "resolved",
  subjectKey: "event:dup-1",
  related: {},
  evidence: { deliveries: 2 },
  occurrences: 2,
  firstSeenAt: iso(NOW - 12 * DAY),
  lastSeenAt: iso(NOW - 12 * DAY),
  resolvedAt: iso(NOW - 11 * DAY),
  resolution: "Duplicate delivery from Lava; ignored by the semantic key",
});

// ── Education ───────────────────────────────────────────────────────────
// Seeded with generators of its own (prngFor), never the shared `random`:
// everything seeded above stays exactly as it was.

// The education editor joined last: created here, with its own generator.
{
  const local = prngFor("edu-editor");
  const def = personaDefs.editor;
  const createdAt = NOW - 12 * DAY;
  const user: User = {
    id: uuidFrom(local),
    email: def.email,
    emailVerified: true,
    displayName: def.name,
    locale: def.locale,
    status: "active",
    version: 1,
    createdAt: iso(createdAt),
    sessions: 1,
    googleLinked: false,
  };
  users.push(user);
  personaIds.editor = user.id;
  const reason = "Runs the textbooks at edu.outegro.dev";
  bindings.push({
    id: uuidFrom(local),
    userId: user.id,
    role: "edu_editor",
    scope: "platform",
    state: "active",
    expiresAt: null,
    grantedBy: personaIds.owner,
    reason,
    createdAt: iso(createdAt + HOUR),
    revokedAt: null,
    revokedBy: null,
  });
  authAudit.push({
    id: uuidFrom(local),
    actorId: personaIds.owner,
    action: "role.granted",
    targetType: "user",
    targetId: user.id,
    reason,
    data: { role: "edu_editor" },
    requestId: "req-edu-editor",
    createdAt: iso(createdAt + HOUR),
  });
  authAudit.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

type EduRule =
  | { mode: "free" }
  | { mode: "signed_in" }
  | { mode: "grant"; features: string[]; previewChapters: number };
type Book = {
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  rule: EduRule;
  contentVersion: number;
  contentHash: string;
  stats: {
    chapters: number;
    figures: number;
    exercises: number;
    explain: number;
    sandboxes: number;
    cards: number;
  };
  importedAt: string;
  publishedAt: string | null;
  updatedAt: string;
  version: number;
  chapters: {
    short: string;
    title: string;
    exercises: number;
    cards: number;
  }[];
};
type Reading = {
  userId: string;
  book: string;
  exercisesSolved: number;
  cardsKnown: number;
  lastChapter: number | null;
  startedAt: string;
  lastActiveAt: string;
};

const contentHash = (key: string) => {
  const next = prngFor(key);
  return Array.from({ length: 64 }, () =>
    Math.floor(next() * 16).toString(16),
  ).join("");
};
const chaptersOf = (rows: [string, string, number, number][]) =>
  rows.map(([short, title, exercises, cards]) => ({
    short,
    title,
    exercises,
    cards,
  }));
const paidBy = (slug: string): EduRule => ({
  mode: "grant",
  features: ["library", `book.${slug}`],
  previewChapters: 1,
});
// The two real books: titles, chapters and numbers of their content.
const books: Book[] = [
  {
    slug: "nodejs-internals",
    title: "Node.js изнутри",
    status: "published",
    rule: paidBy("nodejs-internals"),
    contentVersion: 3,
    contentHash: contentHash("nodejs-internals@3"),
    stats: {
      chapters: 13,
      figures: 55,
      exercises: 76,
      explain: 65,
      sandboxes: 0,
      cards: 122,
    },
    importedAt: iso(NOW - 9 * DAY),
    publishedAt: iso(NOW - 21 * DAY),
    updatedAt: iso(NOW - 9 * DAY),
    version: 1,
    chapters: chaptersOf([
      ["Устройство", "Что такое Node.js и из чего он состоит", 6, 10],
      ["Модули", "Модули: CommonJS и ES Modules", 6, 9],
      ["Асинхронность", "Асинхронность: колбэки, промисы, async/await", 6, 10],
      ["Event loop", "Event loop: как один поток успевает всё", 6, 10],
      ["libuv и потоки", "libuv и пул потоков", 6, 9],
      ["Buffer", "Buffer и кодировки", 5, 9],
      ["Streams", "Streams: данные по кусочкам", 5, 9],
      ["EventEmitter", "EventEmitter и событийная модель", 6, 9],
      ["HTTP-сервер", "HTTP-сервер изнутри", 6, 9],
      ["Ошибки и процесс", "Ошибки, процесс и graceful shutdown", 5, 10],
      [
        "Потоки и процессы",
        "Параллельность: worker_threads, child_process, cluster",
        5,
        9,
      ],
      ["Память и GC", "Память, сборщик мусора и производительность", 6, 10],
      ["Ловушки", "Хитрые моменты: сборник ловушек", 8, 9],
    ]),
  },
  {
    slug: "sql-internals",
    title: "SQL изнутри",
    status: "published",
    rule: paidBy("sql-internals"),
    contentVersion: 2,
    contentHash: contentHash("sql-internals@2"),
    stats: {
      chapters: 13,
      figures: 71,
      exercises: 120,
      explain: 66,
      sandboxes: 102,
      cards: 121,
    },
    importedAt: iso(NOW - 4 * DAY),
    publishedAt: iso(NOW - 15 * DAY),
    updatedAt: iso(NOW - 4 * DAY),
    version: 0,
    chapters: chaptersOf([
      ["Таблицы и ключи", "Реляционная модель: таблицы, ключи, связи", 11, 9],
      [
        "SELECT",
        "SELECT: в каком порядке на самом деле выполняется запрос",
        10,
        9,
      ],
      ["NULL", "NULL и трёхзначная логика", 11, 10],
      ["JOIN", "JOIN без кругов Эйлера", 10, 9],
      ["GROUP BY", "Агрегация и GROUP BY", 11, 10],
      ["Подзапросы и CTE", "Подзапросы и CTE", 11, 10],
      [
        "Оконные функции",
        "Оконные функции: считаем по группе и не теряем строки",
        10,
        9,
      ],
      [
        "INSERT, UPDATE, DDL",
        "Изменение данных и схемы: INSERT, UPDATE, UPSERT, ALTER",
        9,
        9,
      ],
      [
        "Индексы",
        "Индексы: как база находит строку, не читая всю таблицу",
        7,
        10,
      ],
      ["EXPLAIN", "EXPLAIN и производительность запросов", 7, 10],
      ["Транзакции", "Транзакции, ACID и уровни изоляции", 7, 9],
      ["MVCC и блокировки", "MVCC, блокировки и конкуренция", 7, 9],
      ["Проектирование", "Проектирование схемы и масштабирование", 9, 8],
    ]),
  },
];
const bookOf = (slug: string) => books.find((book) => book.slug === slug);

// Reading access is a Payments grant (service edu): no product sells books
// yet, so every one of these was given by hand.
function eduGrant(
  key: string,
  user: User,
  feature: string,
  options: {
    from: number;
    until: number | null;
    reason: string;
    /** When it was given, if not when it starts (a grant booked ahead). */
    grantedAt?: number;
    revoked?: { at: number; reason: string };
  },
) {
  const local = prngFor(`edu-grant-${key}`);
  const grant: PayGrant = {
    id: uuidFrom(local),
    userId: user.id,
    service: "edu",
    feature,
    sourceType: "manual",
    sourceId: uuidFrom(local),
    state: options.revoked ? "revoked" : "active",
    validFrom: iso(options.from),
    validUntil: options.until === null ? null : iso(options.until),
    version: options.revoked ? 2 : 1,
    reason: options.reason,
    grantedBy: personaIds.owner,
    revokedAt: options.revoked ? iso(options.revoked.at) : null,
    revokedBy: options.revoked ? personaIds.owner : null,
    revokeReason: options.revoked?.reason ?? null,
  };
  payGrants.push(grant);
  paymentsAudit.push({
    id: uuidFrom(local),
    actorId: personaIds.owner,
    action: "grant.created",
    targetType: "grant",
    targetId: grant.id,
    reason: options.reason,
    data: {},
    requestId: null,
    createdAt: iso(options.grantedAt ?? options.from),
  });
}
const dmitry = userByEmail("d.volkov@example.ru");
const artem = userByEmail("artem.k@example.ru");
const ivan = userByEmail("ivan.sokolov@example.ru");
eduGrant("oleg", oleg, "library", {
  from: NOW - 14 * DAY,
  until: null,
  reason: "Beta reader of both books",
});
eduGrant("mira", mira, "book.nodejs-internals", {
  from: NOW - 11 * DAY,
  until: null,
  reason: "Wrote the errata for the event loop chapter",
});
eduGrant("dmitry", dmitry, "book.nodejs-internals", {
  from: NOW - 8 * DAY,
  until: NOW + 52 * DAY,
  reason: "Interview prep sponsored by the Node.js meetup",
});
eduGrant("artem", artem, "library", {
  from: NOW - 5 * DAY,
  until: NOW + 25 * DAY,
  reason: "Technical review of the SQL book",
});
eduGrant("ivan", ivan, "library", {
  from: NOW - 13 * DAY,
  until: null,
  reason: "Prize of the September quiz",
  revoked: { at: NOW - 12 * DAY, reason: "Given to the wrong account" },
});
// Payments still calls both of these active: Artem's next review round is
// booked to start when his library grant ends, and his grant for the first
// Node.js draft ran out three days ago without being marked expired yet.
eduGrant("artem-sql", artem, "book.sql-internals", {
  from: NOW + 25 * DAY,
  until: NOW + 90 * DAY,
  grantedAt: NOW - 2 * DAY,
  reason: "Second review round of the SQL book",
});
eduGrant("artem-nodejs", artem, "book.nodejs-internals", {
  from: NOW - 40 * DAY,
  until: NOW - 3 * DAY,
  reason: "Review of the first Node.js draft",
});

// Readers: a paid book opens its first chapter to anyone signed in, so
// readers without a grant stop at chapter 1.
const readings: Reading[] = [];
function read(
  user: User,
  slug: string,
  lastChapter: number | null,
  hoursAgo: number,
) {
  const book = bookOf(slug) as Book;
  const local = prngFor(`edu-reading-${user.id}-${slug}`);
  const upTo = book.chapters.slice(0, lastChapter ?? 0);
  const exercises = upTo.reduce((sum, chapter) => sum + chapter.exercises, 0);
  const cards = upTo.reduce((sum, chapter) => sum + chapter.cards, 0);
  readings.push({
    userId: user.id,
    book: slug,
    exercisesSolved: Math.round(exercises * (0.55 + local() * 0.45)),
    cardsKnown: Math.round(cards * (0.3 + local() * 0.6)),
    lastChapter,
    startedAt: iso(NOW - hoursAgo * HOUR - (2 + Math.floor(local() * 9)) * DAY),
    lastActiveAt: iso(NOW - hoursAgo * HOUR),
  });
}
read(mira, "nodejs-internals", 7, 2);
read(mira, "sql-internals", 1, 26);
read(oleg, "nodejs-internals", 4, 50);
read(oleg, "sql-internals", 9, 5);
read(dmitry, "nodejs-internals", 12, 1);
read(artem, "sql-internals", 6, 30);
read(ivan, "sql-internals", 1, 8 * 24);
{
  const local = prngFor("edu-readers");
  const named = new Set([mira.id, oleg.id, dmitry.id, artem.id, ivan.id]);
  // Never readers: Hana Kim has done nothing anywhere (the empty states rely
  // on her), and Tom Becker gets his first book by hand in education.spec.
  const never = new Set([
    userByEmail("hana.kim@example.kr").id,
    userByEmail("tom.becker@example.de").id,
  ]);
  const pool = users.filter(
    (user) =>
      user.status === "active" &&
      !never.has(user.id) &&
      !named.has(user.id) &&
      !Object.values(personaIds).includes(user.id),
  );
  for (let index = 0; index < 10 && pool.length > 0; index++) {
    const [user] = pool.splice(Math.floor(local() * pool.length), 1) as [User];
    const slug = local() < 0.6 ? "nodejs-internals" : "sql-internals";
    read(user, slug, local() < 0.2 ? null : 1, 3 + Math.floor(local() * 300));
  }
}

const eduSolved7d = 40 + Math.floor(prngFor("edu-solved")() * 50);
// The AI assistant's week (edu-backend through MiniMax): fixed numbers, so
// shares and number formatting can be checked exactly. On, it made 37 of
// its 500 model calls for today (the default spending cap). Switched off
// ("fake-assist=off"), it keeps its reader limit, has no spending cap and
// was not used this week. Paused ("fake-assist=paused"), a busy day used up
// a cap raised to 1,000 calls: no new answers for readers until 00:00 UTC.
const eduAssist = {
  on: {
    enabled: true,
    dailyLimit: 30,
    globalDailyLimit: 500,
    globalUsedToday: 37,
    requests7d: 1284,
    cached7d: 321,
    failed7d: 13,
    tokensIn7d: 2_486_910,
    tokensOut7d: 612_304,
  },
  paused: {
    enabled: true,
    dailyLimit: 30,
    globalDailyLimit: 1000,
    globalUsedToday: 1000,
    requests7d: 2487,
    cached7d: 561,
    failed7d: 24,
    tokensIn7d: 5_086_910,
    tokensOut7d: 1_262_304,
  },
  off: {
    enabled: false,
    dailyLimit: 30,
    globalDailyLimit: 0,
    globalUsedToday: 0,
    requests7d: 0,
    cached7d: 0,
    failed7d: 0,
    tokensIn7d: 0,
    tokensOut7d: 0,
  },
} satisfies Record<string, AdminOverview["assist"]>;
const assistOf = (req: IncomingMessage) => {
  const agent = String(req.headers["user-agent"] ?? "");
  if (agent.includes("fake-assist=off")) return eduAssist.off;
  if (agent.includes("fake-assist=paused")) return eduAssist.paused;
  return eduAssist.on;
};
// Readers active per day, today last; built per request for today's date.
const eduActivity = (() => {
  const local = prngFor("edu-activity");
  return Array.from({ length: 14 }, (_, index) => ({
    daysAgo: 13 - index,
    readers: 2 + Math.floor(local() * 6) + Math.floor(index / 4),
  }));
})();

const eduAudit: Audit[] = [];
const eduEntry = (
  key: string,
  entry: Omit<Audit, "id" | "requestId" | "createdAt"> & { at: number },
) => {
  const { at, ...rest } = entry;
  eduAudit.push({
    id: uuidFrom(prngFor(`edu-audit-${key}`)),
    requestId: null,
    createdAt: iso(at),
    ...rest,
  });
};
// Content imports run with the migrations: no actor, no reason.
const imported = (slug: string, version: number, at: number) =>
  eduEntry(`${slug}@${version}`, {
    actorId: null,
    action: "book.imported",
    targetType: "book",
    targetId: slug,
    reason: null,
    data: {
      contentVersion: version,
      contentHash: contentHash(`${slug}@${version}`),
    },
    at,
  });
imported("nodejs-internals", 1, NOW - 21 * DAY);
imported("sql-internals", 1, NOW - 15 * DAY);
imported("nodejs-internals", 2, NOW - 12 * DAY);
eduEntry("nodejs-preview", {
  actorId: personaIds.owner,
  action: "book.access.changed",
  targetType: "book",
  targetId: "nodejs-internals",
  reason: "One free chapter is enough to judge the book",
  data: {
    before: { rule: { ...paidBy("nodejs-internals"), previewChapters: 2 } },
    after: { rule: paidBy("nodejs-internals") },
  },
  at: NOW - 10 * DAY,
});
imported("nodejs-internals", 3, NOW - 9 * DAY);
imported("sql-internals", 2, NOW - 4 * DAY);
eduAudit.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
// A newer edu-backend ("fake-audit=future") also records an action that the
// console's contract does not name yet.
const futureEduAudit: Audit = {
  id: uuidFrom(prngFor("edu-audit-future")),
  actorId: personaIds.owner,
  action: "book.cover.changed",
  targetType: "book",
  targetId: "sql-internals",
  reason: "New cover for the launch",
  data: { before: { cover: "sql-v1.webp" }, after: { cover: "sql-v2.webp" } },
  requestId: null,
  createdAt: iso(NOW - 2 * HOUR),
};

// Identity's projection of the active grants.
for (const grant of payGrants.filter((g) => g.state === "active")) {
  const list = identityGrants.get(grant.userId) ?? [];
  list.push({
    grantId: grant.id,
    service: grant.service,
    feature: grant.feature,
    sourceType: grant.sourceType,
    validUntil: grant.validUntil,
  });
  identityGrants.set(grant.userId, list);
}

// ── HTTP plumbing ───────────────────────────────────────────────────────

type Req = IncomingMessage & {
  body?: Record<string, unknown>;
  query: URLSearchParams;
  path: string;
};
// Plain fields: Node strips types but does not support parameter properties.
class HttpError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string[]>;
  constructor(
    status: number,
    code: string,
    fieldErrors: Record<string, string[]> = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
// A declaration (not an arrow) so TypeScript narrows after a call.
function fail(
  status: number,
  code: string,
  fieldErrors: Record<string, string[]> = {},
): never {
  throw new HttpError(status, code, fieldErrors);
}
function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) {
    res.writeHead(status, { "cache-control": "no-store" });
    res.end();
    return;
  }
  const text = JSON.stringify(body, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(text);
}
function errorBody(code: string, fieldErrors: Record<string, string[]> = {}) {
  return {
    error: {
      code,
      messageKey: `errors.${code.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`,
      fieldErrors,
      requestId: `req-${randomBytes(4).toString("hex")}`,
      retryable: code === "DEPENDENCY_UNAVAILABLE",
    },
  };
}
function paginate<T>(items: T[], query: URLSearchParams) {
  const limit = Math.min(
    100,
    Math.max(1, Number(query.get("limit") ?? 25) || 25),
  );
  const cursor = query.get("cursor");
  let offset = 0;
  if (cursor) {
    const decoded = Number(Buffer.from(cursor, "base64url").toString());
    if (!Number.isInteger(decoded) || decoded < 0)
      fail(400, "VALIDATION_FAILED", { cursor: ["invalid"] });
    offset = decoded;
  }
  const page = items.slice(offset, offset + limit);
  return {
    items: page,
    nextCursor:
      offset + limit < items.length
        ? Buffer.from(String(offset + limit)).toString("base64url")
        : null,
  };
}
const reasonOf = (body: Record<string, unknown> | undefined) => {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 || reason.length > 500)
    fail(400, "VALIDATION_FAILED", { reason: ["3..500 characters"] });
  return reason;
};
function need(req: Req, permission: string): Persona {
  const persona = personaOf(req);
  if (!persona) fail(401, "UNAUTHENTICATED");
  if (!permissionsOf(persona as Persona).includes(permission))
    fail(403, "FORBIDDEN");
  return persona as Persona;
}
const actorOf = (persona: Persona) => personaIds[persona];
const terminus = (up: boolean, deps: string[]) => {
  const details = Object.fromEntries(
    deps.map((dep, index) => [
      dep,
      up || index < deps.length - 1
        ? { status: "up" }
        : { status: "down", message: "connection refused" },
    ]),
  );
  return {
    status: up ? "ok" : "error",
    info: up ? details : {},
    error: up ? {} : details,
    details,
  };
};

// ── Routes ──────────────────────────────────────────────────────────────

type Handler = (
  req: Req,
  res: ServerResponse,
  params: string[],
) => unknown | Promise<unknown>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) =>
  routes.push({
    method,
    pattern: new RegExp(`^${path.replace(/:[a-zA-Z]+/g, "([^/]+)")}$`),
    handler,
  });

route("GET", "/health", () => ({ status: "ok", service: "fake-platform" }));

// Every request made with "fake-trace=<tag>" in the User-Agent (the console
// forwards it), kept under that tag: a test reads back which calls a page
// made, e.g. that a list asks Identity nothing per row.
const traces = new Map<string, string[]>();
route("GET", "/__trace/:tag", (_req, _res, [tag]) => ({
  requests: traces.get(tag as string) ?? [],
}));

// Identity frontend: pick a persona instead of signing in.
route("GET", "/authorize", (req, res) => {
  const query = req.query;
  if (
    query.get("client_id") !== "admin-web" ||
    !query.get("redirect_uri") ||
    query.get("code_challenge_method") !== "S256"
  ) {
    res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
    res.end(
      "<!DOCTYPE html><title>Invalid request</title><p>Invalid authorization request</p>",
    );
    return;
  }
  const links = (Object.keys(personaDefs) as Persona[])
    .map((key) => {
      const params = new URLSearchParams(query);
      params.set("persona", key);
      const def = personaDefs[key];
      return `<li><a href="/authorize/approve?${params.toString()}">Continue as ${def.name} (${key})</a></li>`;
    })
    .join("");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Fake identity</title><link rel="icon" href="data:,"></head><body><main><h1>Fake identity (e2e)</h1><ul>${links}</ul></main></body></html>`,
  );
});
route("GET", "/authorize/approve", (req, res) => {
  const query = req.query;
  const persona = query.get("persona") as Persona;
  if (!(persona in personaDefs)) fail(400, "VALIDATION_FAILED");
  const code = randomBytes(24).toString("base64url");
  codes.set(code, {
    persona,
    challenge: query.get("code_challenge") ?? "",
    redirectUri: query.get("redirect_uri") ?? "",
    clientId: query.get("client_id") ?? "",
    used: false,
    until: Date.now() + 60_000,
  });
  const target = new URL(query.get("redirect_uri") ?? "");
  target.searchParams.set("code", code);
  target.searchParams.set("state", query.get("state") ?? "");
  res.writeHead(302, { location: target.toString() });
  res.end();
});

route("GET", "/auth/health/deep", () =>
  terminus(true, ["postgres", "valkey", "rabbitmq"]),
);
route("POST", "/auth/v1/oauth/token", (req) => {
  const body = req.body ?? {};
  const entry = codes.get(String(body.code ?? ""));
  const challenge = createHash("sha256")
    .update(String(body.codeVerifier ?? ""))
    .digest("base64url");
  if (
    !entry ||
    entry.used ||
    entry.until < Date.now() ||
    entry.redirectUri !== body.redirectUri ||
    entry.clientId !== body.clientId ||
    entry.challenge !== challenge
  )
    fail(400, "VALIDATION_FAILED", { code: ["invalid_grant"] });
  (entry as { used: boolean }).used = true;
  const session: Session = {
    id: uuid(),
    persona: (entry as { persona: Persona }).persona,
    refresh: randomBytes(32).toString("base64url"),
    previous: null,
    previousUntil: 0,
  };
  sessions.set(session.id, session);
  return tokensFor(session);
});
route("POST", "/auth/v1/sessions/refresh", (req) => {
  const token = String(req.body?.refreshToken ?? "");
  for (const session of sessions.values()) {
    if (
      session.refresh === token ||
      (session.previous === token && session.previousUntil > Date.now())
    ) {
      if (session.refresh === token) {
        session.previous = token;
        session.previousUntil = Date.now() + 10_000;
        session.refresh = randomBytes(32).toString("base64url");
      }
      return tokensFor(session);
    }
  }
  return fail(401, "UNAUTHENTICATED");
});
route("POST", "/auth/v1/sessions/logout", (req, res) => {
  const token = String(req.body?.refreshToken ?? "");
  for (const [id, session] of sessions)
    if (session.refresh === token) sessions.delete(id);
  send(res, 204);
});
route("GET", "/auth/v1/me", (req) => {
  const persona = personaOf(req);
  if (!persona) return fail(401, "UNAUTHENTICATED");
  const user = users.find((item) => item.id === personaIds[persona]) as User;
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    locale: user.locale,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt,
    roles: rolesOf(user.id),
    permissions: permissionsOf(persona),
  };
});
const profile = (user: User) => ({
  id: user.id,
  email: user.email,
  emailVerified: user.emailVerified,
  displayName: user.displayName,
  locale: user.locale,
  status: user.status,
  version: user.version,
  createdAt: user.createdAt,
});
route("GET", "/auth/v1/admin/overview", (req) => {
  need(req, "users.read");
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(NOW - (6 - i) * DAY).toISOString().slice(0, 10),
  );
  const created = users.map((user) => user.createdAt.slice(0, 10));
  const roleCounts: Record<string, number> = {};
  for (const binding of bindings.filter((b) => b.state === "active"))
    roleCounts[binding.role] = (roleCounts[binding.role] ?? 0) + 1;
  const active = users.filter((u) => u.status === "active");
  return {
    generatedAt: iso(Date.now()),
    users: {
      total: users.length,
      active: active.length,
      suspended: users.filter((u) => u.status === "suspended").length,
      new24h: users.filter((u) => Date.parse(u.createdAt) > Date.now() - DAY)
        .length,
      new7d: users.filter((u) => Date.parse(u.createdAt) > Date.now() - 7 * DAY)
        .length,
    },
    sessions: {
      active: users.reduce((sum, u) => sum + u.sessions, 0),
      seen24h: Math.round(users.reduce((sum, u) => sum + u.sessions, 0) * 0.6),
      byClient: { "id-web": 31, "admin-web": 5, "battleship-web": 22 },
    },
    signIns7d: { email: 126, sso: 58, google: 34, passkey: 9 },
    roleBindings: roleCounts,
    googleLinked: users.filter((u) => u.googleLinked).length,
    dailySignups: days
      .map((day) => ({ day, n: created.filter((c) => c === day).length }))
      .filter((row) => row.n > 0),
  };
});
route("GET", "/auth/v1/admin/audit", (req) => {
  need(req, "audit.read");
  const q = req.query;
  const list = authAudit.filter(
    (entry) =>
      (!q.get("targetId") || entry.targetId === q.get("targetId")) &&
      (!q.get("actorId") || entry.actorId === q.get("actorId")) &&
      (!q.get("action") || entry.action === q.get("action")),
  );
  return paginate(list, q);
});
route("GET", "/auth/v1/admin/users", (req) => {
  need(req, "users.read");
  const term = (req.query.get("query") ?? "").toLowerCase();
  const list = users
    .filter((user) => !term || user.email.includes(term))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const page = paginate(list, req.query);
  return { items: page.items.map(profile), nextCursor: page.nextCursor };
});
route("GET", "/auth/v1/admin/users/:id", (req, _res, [id]) => {
  need(req, "users.read");
  const user = users.find((item) => item.id === id) ?? fail(404, "NOT_FOUND");
  return {
    user: profile(user as User),
    roleBindings: bindings
      .filter((b) => b.userId === id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    activeSessions: (user as User).sessions,
    grants: identityGrants.get(id as string) ?? [],
  };
});
function activeOwners(except?: string) {
  return bindings.filter(
    (b) =>
      b.role === "owner" &&
      b.state === "active" &&
      b.userId !== except &&
      users.find((u) => u.id === b.userId)?.status === "active",
  );
}
route("POST", "/auth/v1/admin/users/:id/role-bindings", (req, _res, [id]) => {
  const persona = need(req, "roles.assign");
  const reason = reasonOf(req.body);
  const role = String(req.body?.role ?? "");
  if (!(role in platformRoles))
    fail(400, "VALIDATION_FAILED", { role: ["unknown role"] });
  if (!users.some((u) => u.id === id)) fail(404, "NOT_FOUND");
  if (
    bindings.some(
      (b) => b.userId === id && b.role === role && b.state === "active",
    )
  )
    fail(409, "CONFLICT");
  const binding: Binding = {
    id: uuid(),
    userId: id as string,
    role,
    scope: "platform",
    state: "active",
    expiresAt: (req.body?.expiresAt as string | null) ?? null,
    grantedBy: actorOf(persona),
    reason,
    createdAt: iso(Date.now()),
    revokedAt: null,
    revokedBy: null,
  };
  bindings.push(binding);
  audit(authAudit, {
    actorId: actorOf(persona),
    action: "role.granted",
    targetType: "user",
    targetId: id as string,
    reason,
    data: { bindingId: binding.id, role },
  });
  return binding;
});
route("POST", "/auth/v1/admin/role-bindings/:id/revoke", (req, res, [id]) => {
  const persona = need(req, "roles.assign");
  const reason = reasonOf(req.body);
  const binding =
    bindings.find((b) => b.id === id && b.state === "active") ??
    fail(404, "NOT_FOUND");
  const target = binding as Binding;
  if (target.role === "owner" && activeOwners(target.userId).length === 0)
    fail(422, "UNPROCESSABLE");
  target.state = "revoked";
  target.revokedAt = iso(Date.now());
  target.revokedBy = actorOf(persona);
  audit(authAudit, {
    actorId: actorOf(persona),
    action: "role.revoked",
    targetType: "user",
    targetId: target.userId,
    reason,
    data: { bindingId: target.id, role: target.role },
  });
  send(res, 204);
});
route(
  "POST",
  "/auth/v1/admin/users/:id/sessions/revoke-all",
  (req, _res, [id]) => {
    const persona = need(req, "sessions.revoke");
    const reason = reasonOf(req.body);
    const user = (users.find((item) => item.id === id) ??
      fail(404, "NOT_FOUND")) as User;
    const revoked = user.sessions;
    user.sessions = 0;
    audit(authAudit, {
      actorId: actorOf(persona),
      action: "sessions.revoked",
      targetType: "user",
      targetId: user.id,
      reason,
      data: { count: revoked },
    });
    return { revoked };
  },
);
route("GET", "/auth/v1/admin/users/:id/passkeys", (req, _res, [id]) => {
  need(req, "users.read");
  users.find((item) => item.id === id) ?? fail(404, "NOT_FOUND");
  return { items: passkeysOf.get(id as string) ?? [] };
});
route(
  "POST",
  "/auth/v1/admin/users/:id/passkeys/:passkeyId/revoke",
  (req, res, [id, passkeyId]) => {
    const persona = need(req, "passkeys.revoke");
    const reason = reasonOf(req.body);
    const user = (users.find((item) => item.id === id) ??
      fail(404, "NOT_FOUND")) as User;
    const list = passkeysOf.get(user.id) ?? [];
    const passkey = list.find((item) => item.id === passkeyId);
    if (!passkey) fail(404, "NOT_FOUND");
    const others = list.filter((item) => item.id !== passkeyId && item.usable);
    if (!user.emailVerified && !user.googleLinked && others.length === 0)
      fail(409, "CONFLICT", { passkey: ["last_method"] });
    passkeysOf.set(
      user.id,
      list.filter((item) => item.id !== passkeyId),
    );
    audit(authAudit, {
      actorId: actorOf(persona),
      action: "passkey.revoked",
      targetType: "user",
      targetId: user.id,
      reason,
      data: { passkeyId },
    });
    send(res, 204);
  },
);
route("POST", "/auth/v1/admin/users/:id/status", (req, _res, [id]) => {
  const persona = need(req, "users.suspend");
  const reason = reasonOf(req.body);
  const status = req.body?.status;
  if (status !== "active" && status !== "suspended")
    fail(400, "VALIDATION_FAILED", { status: ["active|suspended"] });
  const user = (users.find((item) => item.id === id) ??
    fail(404, "NOT_FOUND")) as User;
  if (
    status === "suspended" &&
    bindings.some(
      (b) => b.userId === user.id && b.role === "owner" && b.state === "active",
    ) &&
    activeOwners(user.id).length === 0
  )
    fail(422, "UNPROCESSABLE");
  user.status = status;
  user.version += 1;
  if (status === "suspended") user.sessions = 0;
  const player = playerOf(user.id);
  if (player) player.status = status;
  audit(authAudit, {
    actorId: actorOf(persona),
    action: `user.${status}`,
    targetType: "user",
    targetId: user.id,
    reason,
    data: {},
  });
  return profile(user);
});

// Notifications.
const summary = (d: Delivery) => {
  const { intent: _intent, ...rest } = d;
  return rest;
};
route("GET", "/notifications/health/deep", () =>
  terminus(true, ["postgres", "valkey", "rabbitmq"]),
);
route("GET", "/notifications/v1/admin/overview", (req) => {
  need(req, "notifications.read");
  const dayAgo = Date.now() - DAY;
  const last24h: Record<string, Record<string, number>> = {
    email: {},
    telegram: {},
  };
  for (const d of deliveries.filter((x) => Date.parse(x.createdAt) >= dayAgo)) {
    const bucket = last24h[d.channel] as Record<string, number>;
    bucket[d.state] = (bucket[d.state] ?? 0) + 1;
  }
  const backlog = deliveries.filter((d) =>
    ["pending", "retry_wait", "leased"].includes(d.state),
  );
  const daily = new Map<
    string,
    { day: string; channel: string; ok: number; bad: number; total: number }
  >();
  for (const d of deliveries.filter(
    (x) => Date.parse(x.createdAt) >= Date.now() - 7 * DAY,
  )) {
    const key = `${d.createdAt.slice(0, 10)}|${d.channel}`;
    const row = daily.get(key) ?? {
      day: d.createdAt.slice(0, 10),
      channel: d.channel,
      ok: 0,
      bad: 0,
      total: 0,
    };
    if (d.state === "accepted" || d.state === "delivered") row.ok++;
    if (d.state === "failed" || d.state === "expired" || d.state === "unknown")
      row.bad++;
    row.total++;
    daily.set(key, row);
  }
  return {
    generatedAt: iso(Date.now()),
    last24h: {
      deliveries: last24h,
      intents:
        deliveries.filter((x) => Date.parse(x.createdAt) >= dayAgo).length + 12,
    },
    backlog: {
      count: backlog.length,
      oldestCreatedAt: backlog.map((d) => d.createdAt).sort()[0] ?? null,
    },
    daily: [...daily.values()].sort((a, b) =>
      a.day + a.channel < b.day + b.channel ? -1 : 1,
    ),
    recipients: {
      total: users.length - noRecipient.size,
      emailVerified: users.filter((u) => u.emailVerified).length,
      telegramLinked: 17,
    },
    channels: {
      email: {
        provider: "smtp",
        from: "Nick Lukashik <no-reply@outegro.dev>",
        enabled: channelSettings.channels.email.enabled,
      },
      telegram: {
        configured: true,
        botUsername: "outegro_bot",
        webhookConfigured: true,
        linkingAvailable: true,
        enabled: channelSettings.channels.telegram.enabled,
      },
    },
    settingsVersion: channelSettings.version,
  };
});
route("GET", "/notifications/v1/admin/deliveries", (req) => {
  need(req, "notifications.read");
  const q = req.query;
  const list = deliveries.filter(
    (d) =>
      (!q.get("state") || d.state === q.get("state")) &&
      (!q.get("channel") || d.channel === q.get("channel")) &&
      (!q.get("userId") || d.userId === q.get("userId")) &&
      (!q.get("template") || d.templateKey === q.get("template")),
  );
  const page = paginate(list, q);
  return { items: page.items.map(summary), nextCursor: page.nextCursor };
});
const recipientOf = (userId: string) => {
  const user = users.find((u) => u.id === userId);
  if (!user || noRecipient.has(userId)) return null;
  return user;
};
route("GET", "/notifications/v1/admin/deliveries/:id", (req, _res, [id]) => {
  need(req, "notifications.read");
  const d = (deliveries.find((x) => x.id === id) ??
    fail(404, "NOT_FOUND")) as Delivery;
  const user = recipientOf(d.userId);
  return {
    ...summary(d),
    intent: d.intent,
    recipient: user
      ? {
          email: maskEmail(user.email),
          emailVerified: user.emailVerified,
          telegramLinked: user.locale === "ru",
          status: user.status,
          locale: user.locale,
        }
      : null,
    retryable:
      (d.state === "failed" || d.state === "unknown") &&
      d.category !== "auth" &&
      Date.parse(d.intent.expiresAt) > Date.now(),
  };
});
route(
  "POST",
  "/notifications/v1/admin/deliveries/:id/retry",
  (req, _res, [id]) => {
    const persona = need(req, "notifications.retry");
    const reason = reasonOf(req.body);
    const d = (deliveries.find((x) => x.id === id) ??
      fail(404, "NOT_FOUND")) as Delivery;
    if (d.category === "auth") fail(409, "CONFLICT", { delivery: ["private"] });
    if (d.state !== "failed" && d.state !== "unknown")
      fail(409, "CONFLICT", { state: ["not_retryable"] });
    if (Date.parse(d.intent.expiresAt) <= Date.now())
      fail(409, "CONFLICT", { intent: ["expired"] });
    if (d.state === "unknown" && req.body?.confirmUnknown !== true)
      fail(422, "UNPROCESSABLE", { confirmUnknown: ["required"] });
    audit(notificationAudit, {
      actorId: actorOf(persona),
      action: "delivery.retry",
      targetType: "delivery",
      targetId: d.id,
      reason,
      data: {
        previousState: d.state,
        previousAttempts: d.attempts,
        lastError: d.lastError,
      },
    });
    d.state = "pending";
    d.attempts = 0;
    d.nextAttemptAt = iso(Date.now());
    d.updatedAt = iso(Date.now());
    return summary(d);
  },
);
route("GET", "/notifications/v1/admin/recipients/:id", (req, _res, [id]) => {
  need(req, "notifications.read");
  const user = recipientOf(id as string) ?? fail(404, "NOT_FOUND");
  const u = user as User;
  return {
    userId: u.id,
    email: maskEmail(u.email),
    emailVerified: u.emailVerified,
    locale: u.locale,
    status: u.status,
    telegram: {
      linked: u.locale === "ru",
      linkedAt:
        u.locale === "ru" ? iso(Date.parse(u.createdAt) + 2 * DAY) : null,
    },
    optOuts:
      u.id === mira.id
        ? [{ category: "service", channel: "email", enabled: false }]
        : [],
    recentDeliveries: deliveries
      .filter((d) => d.userId === u.id)
      .slice(0, 20)
      .map(summary),
  };
});
route("GET", "/notifications/v1/admin/templates", (req) => {
  need(req, "notifications.read");
  return {
    items: templates.map(({ producer: _producer, ...t }) => ({
      ...t,
      locales: ["en", "ru"],
    })),
  };
});
route(
  "GET",
  "/notifications/v1/admin/templates/:key/preview",
  (req, _res, [key]) => {
    need(req, "notifications.read");
    if (!templates.some((t) => t.key === key)) fail(404, "NOT_FOUND");
    const locale = req.query.get("locale") === "ru" ? "ru" : "en";
    return { key, locale, ...renderEmail(key as string, locale) };
  },
);
route("GET", "/notifications/v1/admin/settings", (req) => {
  need(req, "notifications.read");
  return channelSettings;
});
route("PATCH", "/notifications/v1/admin/settings", (req) => {
  const persona = need(req, "services.flags");
  const reason = reasonOf(req.body);
  if (req.body?.expectedVersion !== channelSettings.version)
    fail(409, "VERSION_CONFLICT");
  const before = structuredClone(channelSettings.channels);
  const patch = (req.body?.channels ?? {}) as Partial<
    typeof channelSettings.channels
  >;
  channelSettings = {
    version: channelSettings.version + 1,
    channels: { ...channelSettings.channels, ...patch },
    updatedAt: iso(Date.now()),
    updatedBy: actorOf(persona),
  };
  audit(notificationAudit, {
    actorId: actorOf(persona),
    action: "settings.channels.update",
    targetType: "settings",
    targetId: "channels",
    reason,
    data: { before, after: channelSettings.channels },
  });
  return channelSettings;
});
route("GET", "/notifications/v1/admin/telegram", (req) => {
  need(req, "notifications.read");
  return {
    configured: true,
    username: "outegro_bot",
    webhook: {
      url: "https://notifications.outegro.dev/telegram/webhook",
      pendingUpdates: 0,
      lastErrorAt: iso(NOW - 26 * HOUR),
      lastError: "Wrong response from the webhook: 502 Bad Gateway",
    },
    expectedWebhookUrl: "https://notifications.outegro.dev/telegram/webhook",
    linkingAvailable: true,
  };
});
route("POST", "/notifications/v1/admin/test-message", (req, res) => {
  const persona = need(req, "notifications.retry");
  const channel = req.body?.channel === "telegram" ? "telegram" : "email";
  const user = users.find((u) => u.id === actorOf(persona)) as User;
  const d = addDelivery({
    user,
    template: templates[3] as (typeof templates)[number],
    channel,
    state: "accepted",
    createdAt: Date.now(),
  });
  deliveries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  send(res, 202, { deliveryId: d.id });
});
route("GET", "/notifications/v1/admin/audit", (req) => {
  need(req, "audit.read");
  return paginate(notificationAudit, req.query);
});

// Battleship.
const participant = (userId: string | null, level: string | null) =>
  userId
    ? { userId, nickname: playerOf(userId)?.nickname ?? null }
    : { bot: level };
const matchItem = (m: Match) => ({
  matchId: m.matchId,
  mode: m.mode,
  status: m.status,
  players: { a: participant(m.a, null), b: participant(m.b, m.botLevel) },
  winner: m.winner,
  reason: m.reason,
  abortReason: m.abortReason,
  moves: m.moves.filter((move) => move.outcome !== "skip").length,
  rated: m.rated,
  ratingDelta: m.ratingDelta,
  createdAt: m.createdAt,
  battleStartedAt: m.battleStartedAt,
  finishedAt: m.finishedAt,
});
route("GET", "/battleship/health/deep", () =>
  terminus(true, ["postgres", "valkey", "rabbitmq"]),
);
route("GET", "/battleship/v1/admin/overview", (req) => {
  need(req, "battleship.read");
  const live = matches.filter(
    (m) => m.status === "battle" || m.status === "placement",
  );
  const activeMatches = { bot: 0, quick: 0, private: 0 };
  for (const m of live) activeMatches[m.mode]++;
  const botWinRate = Object.fromEntries(
    levels.map((level) => {
      const played = matches.filter(
        (m) =>
          m.mode === "bot" && m.status === "finished" && m.botLevel === level,
      );
      const botWins = played.filter((m) => m.winner === "b").length;
      return [
        level,
        {
          matches: played.length,
          botWins,
          rate: played.length ? botWins / played.length : null,
        },
      ];
    }),
  );
  return {
    socketsOnline: players.filter((p) => p.online).length + 3,
    playersOnline: players.filter((p) => p.online).length,
    activeMatches,
    queueSize: 2,
    matchesToday: matches.filter(
      (m) => Date.parse(m.createdAt) > Date.now() - DAY,
    ).length,
    matches7d: matches.length,
    newPlayers7d: players.filter(
      (p) => Date.parse(p.createdAt) > Date.now() - 7 * DAY,
    ).length,
    premiumPlayers: players.filter((p) => p.premium).length,
    botWinRate,
  };
});
route("GET", "/battleship/v1/admin/matches", (req) => {
  need(req, "battleship.read");
  const q = req.query;
  const user = q.get("userId");
  const list = matches.filter(
    (m) =>
      (!q.get("status") || m.status === q.get("status")) &&
      (!q.get("mode") || m.mode === q.get("mode")) &&
      (!user || m.a === user || m.b === user),
  );
  const page = paginate(list, q);
  return { items: page.items.map(matchItem), nextCursor: page.nextCursor };
});
route("GET", "/battleship/v1/admin/matches/:id", (req, _res, [id]) => {
  need(req, "battleship.read");
  const m = (matches.find((x) => x.matchId === id) ??
    fail(404, "NOT_FOUND")) as Match;
  const last = m.moves.at(-1);
  const turn =
    m.status === "battle"
      ? last
        ? last.outcome === "miss"
          ? last.side === "a"
            ? "b"
            : "a"
          : last.side
        : m.firstTurn
      : null;
  return {
    ...matchItem(m),
    firstTurn: m.firstTurn,
    fleets: m.fleets,
    moves: m.moves,
    live:
      m.status === "battle" || m.status === "placement"
        ? {
            phase: m.status,
            turn,
            deadline: iso(Date.now() + 25_000),
            graceUntil: {},
            connected: {
              a: true,
              b: m.b ? m.matchId !== liveMatch.matchId : true,
            },
          }
        : null,
  };
});
route("POST", "/battleship/v1/admin/matches/:id/abort", (req, _res, [id]) => {
  const persona = need(req, "battleship.moderate");
  const reason = reasonOf(req.body);
  const m = (matches.find((x) => x.matchId === id) ??
    fail(404, "NOT_FOUND")) as Match;
  if (m.status !== "battle" && m.status !== "placement") fail(409, "CONFLICT");
  m.status = "aborted";
  m.abortReason = "moderation";
  m.finishedAt = iso(Date.now());
  audit(battleshipAudit, {
    actorId: actorOf(persona),
    action: "match.aborted",
    targetType: "match",
    targetId: m.matchId,
    reason,
    data: {},
  });
  return { matchId: m.matchId, status: "aborted" };
});
const playerItem = (p: Player) => {
  const { premium: _premium, ...rest } = p;
  return rest;
};
route("GET", "/battleship/v1/admin/players", (req) => {
  need(req, "battleship.read");
  const term = (req.query.get("query") ?? "").trim().toLowerCase();
  const list = players
    .filter(
      (p) =>
        !term || p.userId === term || p.nickname.toLowerCase().includes(term),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const page = paginate(list, req.query);
  return { items: page.items.map(playerItem), nextCursor: page.nextCursor };
});
route("GET", "/battleship/v1/admin/players/:id", (req, _res, [id]) => {
  need(req, "battleship.read");
  const p = (players.find((x) => x.userId === id) ??
    fail(404, "NOT_FOUND")) as Player;
  const own = matches.filter((m) => m.a === p.userId || m.b === p.userId);
  const local = prngFor(p.userId);
  let rating = p.rating;
  const history = own
    .filter((m) => m.rated && m.status === "finished" && m.ratingDelta)
    .sort((a, b) => ((a.finishedAt ?? "") < (b.finishedAt ?? "") ? 1 : -1))
    .map((m) => {
      const won =
        (m.winner === "a" && m.a === p.userId) ||
        (m.winner === "b" && m.b === p.userId);
      const delta = (won ? 1 : -1) * (m.ratingDelta as number);
      const after = rating;
      rating -= delta;
      return {
        matchId: m.matchId,
        before: after - delta,
        after,
        delta,
        at: m.finishedAt as string,
      };
    });
  // Older quick matches the fake never seeded, like the real table keeps.
  let at = Date.parse(history.at(-1)?.at ?? iso(NOW - 5 * HOUR));
  while (history.length < Math.min(24, p.ratedMatches)) {
    at -= (5 + Math.floor(local() * 40)) * HOUR;
    const won = local() < (p.matches ? p.wins / p.matches : 0.5);
    const delta = (won ? 1 : -1) * (8 + Math.floor(local() * 16));
    const after = rating;
    rating -= delta;
    history.push({
      matchId: uuidFrom(local),
      before: after - delta,
      after,
      delta,
      at: iso(at),
    });
  }
  const currentStreak = Math.floor(local() * 5);
  const longestStreak = currentStreak + 3 + Math.floor(local() * 8);
  const shots = own.flatMap((m) =>
    m.moves.filter((move) => (move.side === "a" ? m.a : m.b) === p.userId),
  );
  return {
    player: {
      ...playerItem(p),
      ratedWins: Math.floor(p.ratedMatches * 0.5),
      currentStreak,
      longestStreak,
      cosmetics: {
        ships: p.premium ? "silver" : "classic",
        hitEffect: "flame",
        theme: p.premium ? "night-sea" : "day",
      },
      activeMatchId: own.find((m) => m.status === "battle")?.matchId ?? null,
    },
    stats: {
      matches: p.matches,
      wins: p.wins,
      losses: p.losses,
      winRate: p.matches ? p.wins / p.matches : null,
      accuracy: shots.length
        ? shots.filter((s) => s.outcome !== "miss").length / shots.length
        : null,
      currentStreak,
      longestStreak,
      averageMovesToWin: 46.5,
      botWins: { easy: 12, medium: 8, hard: 3, expert: 1 },
    },
    ratingHistory: history,
    grants: payGrants
      .filter((g) => g.userId === p.userId && g.service === "battleship")
      .map((g) => ({
        grantId: g.id,
        feature: g.feature,
        sourceType: g.sourceType,
        sourceId: g.sourceId,
        state: g.state,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
        active: g.state === "active",
      })),
  };
});
route(
  "POST",
  "/battleship/v1/admin/players/:id/reset-nickname",
  (req, _res, [id]) => {
    const persona = need(req, "battleship.moderate");
    const reason = reasonOf(req.body);
    const p = (players.find((x) => x.userId === id) ??
      fail(404, "NOT_FOUND")) as Player;
    const previous = p.nickname;
    p.nickname = `Sailor-${randomBytes(2).toString("hex").toUpperCase()}`;
    audit(battleshipAudit, {
      actorId: actorOf(persona),
      action: "player.nickname.reset",
      targetType: "player",
      targetId: p.userId,
      reason,
      data: { previous, next: p.nickname },
    });
    return { userId: p.userId, nickname: p.nickname };
  },
);
route(
  "POST",
  "/battleship/v1/admin/players/:id/leaderboard",
  (req, _res, [id]) => {
    const persona = need(req, "battleship.moderate");
    const reason = reasonOf(req.body);
    const p = (players.find((x) => x.userId === id) ??
      fail(404, "NOT_FOUND")) as Player;
    p.leaderboardHidden = req.body?.hidden === true;
    audit(battleshipAudit, {
      actorId: actorOf(persona),
      action: p.leaderboardHidden
        ? "player.leaderboard.hidden"
        : "player.leaderboard.shown",
      targetType: "player",
      targetId: p.userId,
      reason,
      data: {},
    });
    return { userId: p.userId, leaderboardHidden: p.leaderboardHidden };
  },
);
route("GET", "/battleship/v1/admin/audit", (req) => {
  need(req, "battleship.read");
  const q = req.query;
  const list = battleshipAudit.filter(
    (entry) =>
      (!q.get("targetType") || entry.targetType === q.get("targetType")) &&
      (!q.get("targetId") || entry.targetId === q.get("targetId")),
  );
  const page = paginate(list, q);
  return {
    items: page.items.map(({ createdAt, requestId: _requestId, ...entry }) => ({
      ...entry,
      at: createdAt,
    })),
    nextCursor: page.nextCursor,
  };
});

// Education.
const eduGrantsOf = (userId: string) =>
  payGrants.filter(
    (grant) => grant.userId === userId && grant.service === "edu",
  );
const inForce = (grant: PayGrant) =>
  grant.state === "active" &&
  Date.parse(grant.validFrom) <= Date.now() &&
  (grant.validUntil === null || Date.parse(grant.validUntil) > Date.now());
const readerAccess = (reading: Reading) => {
  const book = bookOf(reading.book) as Book;
  if (book.rule.mode !== "grant") return "open";
  const features = book.rule.features;
  if (
    eduGrantsOf(reading.userId).some(
      (grant) => inForce(grant) && features.includes(grant.feature),
    )
  )
    return "granted";
  return book.rule.previewChapters > 0 ? "preview" : "locked";
};
const readerView = (reading: Reading) => {
  const book = bookOf(reading.book) as Book;
  return {
    userId: reading.userId,
    book: reading.book,
    exercisesSolved: reading.exercisesSolved,
    exercisesTotal: book.stats.exercises,
    cardsKnown: reading.cardsKnown,
    cardsTotal: book.stats.cards,
    lastChapter: reading.lastChapter,
    access: readerAccess(reading),
    startedAt: reading.startedAt,
    lastActiveAt: reading.lastActiveAt,
  };
};
const bookView = (book: Book) => {
  const { chapters: _chapters, ...rest } = book;
  return {
    ...rest,
    readers: readings.filter((reading) => reading.book === book.slug).length,
  };
};
const ruleKey = (rule: EduRule) =>
  JSON.stringify(
    rule.mode === "grant"
      ? { ...rule, features: [...rule.features].sort() }
      : { mode: rule.mode },
  );
route("GET", "/edu/health/deep", () =>
  terminus(true, ["postgres", "valkey", "rabbitmq"]),
);
route("GET", "/edu/v1/admin/overview", (req) => {
  need(req, "edu.read");
  const count = (status: Book["status"]) =>
    books.filter((book) => book.status === status).length;
  const weekAgo = Date.now() - 7 * DAY;
  return {
    books: {
      published: count("published"),
      draft: count("draft"),
      archived: count("archived"),
    },
    readers: {
      total: new Set(readings.map((reading) => reading.userId)).size,
      active7d: new Set(
        readings
          .filter((reading) => Date.parse(reading.lastActiveAt) > weekAgo)
          .map((reading) => reading.userId),
      ).size,
    },
    grants: {
      inForce: payGrants.filter(
        (grant) => grant.service === "edu" && inForce(grant),
      ).length,
    },
    exercisesSolved7d: eduSolved7d,
    activity: eduActivity.map(({ daysAgo, readers }) => ({
      day: new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10),
      readers,
    })),
    assist: assistOf(req),
  };
});
route("GET", "/edu/v1/admin/books", (req) => {
  need(req, "edu.read");
  return { items: books.map(bookView) };
});
route("GET", "/edu/v1/admin/books/:slug", (req, _res, [slug]) => {
  need(req, "edu.read");
  const book = (bookOf(slug as string) ?? fail(404, "NOT_FOUND")) as Book;
  return {
    book: bookView(book),
    chapters: book.chapters.map((chapter, index) => ({
      n: index + 1,
      ...chapter,
      reached: readings.filter(
        (reading) =>
          reading.book === book.slug && (reading.lastChapter ?? 0) >= index + 1,
      ).length,
    })),
  };
});
route("POST", "/edu/v1/admin/books/:slug/status", (req, _res, [slug]) => {
  const persona = need(req, "edu.manage");
  const reason = reasonOf(req.body);
  const input = setBookStatusSchema.safeParse(req.body);
  if (!input.success) fail(400, "VALIDATION_FAILED", { status: ["invalid"] });
  const book = (bookOf(slug as string) ?? fail(404, "NOT_FOUND")) as Book;
  if (input.data.expectedVersion !== book.version)
    fail(409, "VERSION_CONFLICT");
  if (input.data.status === book.status)
    fail(422, "UNPROCESSABLE", { status: ["unchanged"] });
  const before = book.status;
  book.status = input.data.status;
  book.version += 1;
  book.updatedAt = iso(Date.now());
  if (book.status === "published") book.publishedAt = book.updatedAt;
  audit(eduAudit, {
    actorId: actorOf(persona),
    action: "book.status.changed",
    targetType: "book",
    targetId: book.slug,
    reason,
    data: { before: { status: before }, after: { status: book.status } },
  });
  return {
    slug: book.slug,
    status: book.status,
    rule: book.rule,
    version: book.version,
  };
});
route("POST", "/edu/v1/admin/books/:slug/access", (req, _res, [slug]) => {
  const persona = need(req, "edu.manage");
  const reason = reasonOf(req.body);
  const input = setBookAccessSchema.safeParse(req.body);
  if (!input.success) fail(400, "VALIDATION_FAILED", { rule: ["invalid"] });
  const book = (bookOf(slug as string) ?? fail(404, "NOT_FOUND")) as Book;
  if (input.data.expectedVersion !== book.version)
    fail(409, "VERSION_CONFLICT");
  const rule = input.data.rule;
  if (rule.mode === "grant" && rule.previewChapters > book.chapters.length)
    fail(422, "UNPROCESSABLE", {
      "rule.previewChapters": ["more than the chapters"],
    });
  if (ruleKey(rule) === ruleKey(book.rule))
    fail(422, "UNPROCESSABLE", { rule: ["unchanged"] });
  const before = book.rule;
  book.rule = rule;
  book.version += 1;
  book.updatedAt = iso(Date.now());
  audit(eduAudit, {
    actorId: actorOf(persona),
    action: "book.access.changed",
    targetType: "book",
    targetId: book.slug,
    reason,
    // As edu-backend's BookCommands records it.
    data: { before: { rule: before }, after: { rule } },
  });
  return {
    slug: book.slug,
    status: book.status,
    rule: book.rule,
    version: book.version,
  };
});
route("GET", "/edu/v1/admin/readers", (req) => {
  need(req, "edu.read");
  const q = req.query;
  const list = readings
    .filter(
      (reading) =>
        (!q.get("book") || reading.book === q.get("book")) &&
        (!q.get("userId") || reading.userId === q.get("userId")),
    )
    .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
  const page = paginate(list, q);
  return { items: page.items.map(readerView), nextCursor: page.nextCursor };
});
route("GET", "/edu/v1/admin/readers/:userId", (req, _res, [userId]) => {
  need(req, "edu.read");
  const own = readings
    .filter((reading) => reading.userId === userId)
    .sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1));
  const grants = eduGrantsOf(userId as string);
  // Never read and no grant: Education does not know this user.
  if (own.length === 0 && grants.length === 0) fail(404, "NOT_FOUND");
  return {
    userId,
    grants: grants.map((grant) => ({
      grantId: grant.id,
      feature: grant.feature,
      sourceType: grant.sourceType,
      state: grant.state,
      validFrom: grant.validFrom,
      validUntil: grant.validUntil,
      inForce: inForce(grant),
    })),
    books: own.map(readerView),
  };
});
route("GET", "/edu/v1/admin/audit", (req) => {
  need(req, "edu.read");
  const q = req.query;
  const all = String(req.headers["user-agent"] ?? "").includes(
    "fake-audit=future",
  )
    ? [futureEduAudit, ...eduAudit].sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : -1,
      )
    : eduAudit;
  const list = all.filter(
    (entry) => !q.get("targetId") || entry.targetId === q.get("targetId"),
  );
  const page = paginate(list, q);
  return {
    items: page.items.map(({ createdAt, requestId: _requestId, ...entry }) => ({
      ...entry,
      at: createdAt,
    })),
    nextCursor: page.nextCursor,
  };
});

// Payments.
const title = (key: string) =>
  products.find((p) => p.key === key)?.title ?? { en: key, ru: key };
const grantView = (g: PayGrant) => ({
  id: g.id,
  userId: g.userId,
  service: g.service,
  feature: g.feature,
  sourceType: g.sourceType,
  sourceId: g.sourceId,
  state: g.state,
  validFrom: g.validFrom,
  validUntil: g.validUntil,
  version: g.version,
});
const subscriptionView = (s: Subscription) => ({
  id: s.id,
  orderId: s.orderId,
  productKey: s.productKey,
  title: title(s.productKey),
  state: s.state,
  autoRenew: s.autoRenew,
  paidUntil: s.paidUntil,
  accessUntil: iso(Date.parse(s.paidUntil) + s.graceDays * DAY),
  money: money(s.amount, s.currency),
  periodicity: s.periodicity,
  cancelRequestedAt: s.cancelRequestedAt,
  cancelledAt: s.cancelledAt,
  expiredAt: s.expiredAt,
  createdAt: s.createdAt,
});
const paymentView = (p: Payment) => ({
  id: p.id,
  orderId: p.orderId,
  subscriptionId: p.subscriptionId,
  userId: p.userId,
  kind: p.kind,
  state: p.state,
  money: money(p.amount, p.currency),
  providerContractId: p.providerContractId,
  paidAt: p.paidAt,
  confirmedAt: p.confirmedAt,
});
const eventView = (e: ProviderEvent, withPayload = false) => {
  const { payload, fact, ...rest } = e;
  return withPayload ? { ...rest, payload, fact } : rest;
};
const refundView = (r: Refund) => ({
  id: r.id,
  kind: r.kind,
  state: r.state,
  providerRef: r.providerRef,
  paymentId: r.paymentId,
  userId: r.userId,
  refundType: r.refundType,
  money: r.amount !== null && r.currency ? money(r.amount, r.currency) : null,
  reason: r.reason,
  evidence: r.evidence,
  requestedBy: r.requestedBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});
const orderView = (o: Order) => {
  const grant = payGrants.find(
    (g) =>
      (g.sourceType === "purchase" && g.sourceId === o.id) ||
      (g.sourceType === "subscription" && g.sourceId === o.subscriptionId),
  );
  return {
    id: o.id,
    userId: o.userId,
    productKey: o.productKey,
    title: title(o.productKey),
    kind: o.kind,
    status: o.status,
    money: money(o.amount, o.currency),
    priceVersion: 1,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    checkout: { state: o.attempt.state, paymentUrl: null },
    subscriptionId: o.subscriptionId,
    access: grant ? grantView(grant) : null,
  };
};
route("GET", "/payments/health/deep", () =>
  terminus(true, ["postgres", "valkey", "rabbitmq"]),
);
route("GET", "/payments/v1/catalog", () => ({
  checkoutEnabled: true,
  products: products.map((p) => ({
    key: p.key,
    service: p.service,
    feature: p.feature,
    kind: p.kind,
    periodicity: p.periodicity,
    graceDays: p.graceDays,
    title: p.title,
    description: p.description,
    prices: (Object.keys(prices) as Currency[]).map((currency) => ({
      priceId: `${p.key}-${currency}`,
      version: 1,
      money: money(prices[currency], currency),
    })),
  })),
}));
route("GET", "/payments/v1/admin/orders", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const list = orders.filter(
    (o) =>
      (!q.get("status") || o.status === q.get("status")) &&
      (!q.get("userId") || o.userId === q.get("userId")) &&
      (!q.get("productKey") || o.productKey === q.get("productKey")) &&
      (!q.get("from") || o.createdAt >= (q.get("from") as string)) &&
      (!q.get("to") || o.createdAt < (q.get("to") as string)),
  );
  const page = paginate(list, q);
  return { items: page.items.map(orderView), nextCursor: page.nextCursor };
});
route("GET", "/payments/v1/admin/orders/:id", (req, _res, [id]) => {
  need(req, "billing.read");
  const o = (orders.find((x) => x.id === id) ??
    fail(404, "NOT_FOUND")) as Order;
  const orderPayments = payments.filter((p) => p.orderId === o.id);
  const subscription = subscriptions.find((s) => s.orderId === o.id) ?? null;
  const grants = payGrants.filter(
    (g) =>
      (g.sourceType === "purchase" && g.sourceId === o.id) ||
      (subscription &&
        g.sourceType === "subscription" &&
        g.sourceId === subscription.id),
  );
  const orderRefunds = refunds.filter(
    (r) => r.paymentId && orderPayments.some((p) => p.id === r.paymentId),
  );
  const targets = new Set(
    [
      o.id,
      subscription?.id,
      ...orderPayments.map((p) => p.id),
      ...grants.map((g) => g.id),
      ...orderRefunds.map((r) => r.id),
    ].filter(Boolean),
  );
  return {
    order: {
      ...orderView(o),
      userId: o.userId,
      correlationId: o.correlationId,
    },
    attempt: o.attempt,
    payments: orderPayments.map(paymentView),
    subscription: subscription ? subscriptionView(subscription) : null,
    grants: grants.map(grantView),
    refunds: orderRefunds.map(refundView),
    events: events.filter((e) => e.orderId === o.id).map((e) => eventView(e)),
    audit: paymentsAudit
      .filter((a) => targets.has(a.targetId))
      .map(({ requestId: _requestId, ...a }) => a),
  };
});
route("GET", "/payments/v1/admin/payments", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const list = payments.filter(
    (p) =>
      (!q.get("userId") || p.userId === q.get("userId")) &&
      (!q.get("orderId") || p.orderId === q.get("orderId")) &&
      (!q.get("state") || p.state === q.get("state")) &&
      (!q.get("currency") || p.currency === q.get("currency")),
  );
  const page = paginate(list, q);
  return { items: page.items.map(paymentView), nextCursor: page.nextCursor };
});
route("GET", "/payments/v1/admin/subscriptions", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const list = subscriptions
    .filter(
      (s) =>
        (!q.get("userId") || s.userId === q.get("userId")) &&
        (!q.get("state") || s.state === q.get("state")) &&
        (!q.get("productKey") || s.productKey === q.get("productKey")),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const page = paginate(list, q);
  return {
    items: page.items.map((s) => ({
      ...subscriptionView(s),
      userId: s.userId,
      providerStatus: s.providerStatus,
    })),
    nextCursor: page.nextCursor,
  };
});
route("GET", "/payments/v1/admin/provider-events", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const list = events.filter(
    (e) =>
      (!q.get("status") || e.status === q.get("status")) &&
      (!q.get("type") || e.type === q.get("type")) &&
      (!q.get("contractId") || e.contractId === q.get("contractId")) &&
      (!q.get("orderId") || e.orderId === q.get("orderId")),
  );
  const page = paginate(list, q);
  return {
    items: page.items.map((e) => eventView(e)),
    nextCursor: page.nextCursor,
  };
});
route("GET", "/payments/v1/admin/provider-events/:id", (req, _res, [id]) => {
  need(req, "billing.read");
  return eventView(
    (events.find((e) => e.id === id) ??
      fail(404, "NOT_FOUND")) as ProviderEvent,
    true,
  );
});
route("GET", "/payments/v1/admin/issues", (req) => {
  need(req, "billing.read");
  const q = req.query;
  return paginate(
    issues.filter(
      (i) =>
        (!q.get("status") || i.status === q.get("status")) &&
        (!q.get("kind") || i.kind === q.get("kind")),
    ),
    q,
  );
});
route("GET", "/payments/v1/admin/grants", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const list = payGrants
    .filter(
      (g) =>
        (!q.get("userId") || g.userId === q.get("userId")) &&
        (!q.get("state") || g.state === q.get("state")) &&
        (!q.get("sourceType") || g.sourceType === q.get("sourceType")),
    )
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  const page = paginate(list, q);
  return {
    items: page.items.map((g) => ({
      ...grantView(g),
      reason: g.reason,
      grantedBy: g.grantedBy,
      revokedAt: g.revokedAt,
      revokedBy: g.revokedBy,
      revokeReason: g.revokeReason,
    })),
    nextCursor: page.nextCursor,
  };
});
route("GET", "/payments/v1/admin/refunds", (req) => {
  need(req, "billing.read");
  const q = req.query;
  const page = paginate(
    refunds.filter(
      (r) =>
        (!q.get("state") || r.state === q.get("state")) &&
        (!q.get("kind") || r.kind === q.get("kind")),
    ),
    q,
  );
  return { items: page.items.map(refundView), nextCursor: page.nextCursor };
});
route("GET", "/payments/v1/admin/stats", (req) => {
  need(req, "billing.read");
  const to = req.query.get("to")
    ? Date.parse(req.query.get("to") as string)
    : Date.now();
  const from = req.query.get("from")
    ? Date.parse(req.query.get("from") as string)
    : to - 30 * DAY;
  const entries: {
    day: string;
    currency: Currency;
    amount: bigint;
    type: "payment" | "refund";
  }[] = [];
  for (const p of payments) {
    const at = Date.parse(p.paidAt);
    if (at >= from && at < to)
      entries.push({
        day: p.paidAt.slice(0, 10),
        currency: p.currency,
        amount: p.amount,
        type: "payment",
      });
  }
  for (const r of refunds.filter(
    (x) => x.state === "recorded" && x.amount && x.currency,
  )) {
    const at = Date.parse(r.updatedAt);
    if (at >= from && at < to)
      entries.push({
        day: r.updatedAt.slice(0, 10),
        currency: r.currency as Currency,
        amount: -(r.amount as bigint),
        type: "refund",
      });
  }
  const byDay = new Map<
    string,
    {
      day: string;
      currency: Currency;
      gross: bigint;
      refunded: bigint;
      payments: number;
    }
  >();
  for (const entry of entries) {
    const key = `${entry.day}|${entry.currency}`;
    const row = byDay.get(key) ?? {
      day: entry.day,
      currency: entry.currency,
      gross: 0n,
      refunded: 0n,
      payments: 0,
    };
    if (entry.type === "payment") {
      row.gross += entry.amount;
      row.payments++;
    } else row.refunded += -entry.amount;
    byDay.set(key, row);
  }
  const rows = [...byDay.values()].sort((a, b) =>
    a.day + a.currency < b.day + b.currency ? -1 : 1,
  );
  const totals = new Map<
    string,
    { gross: bigint; refunded: bigint; payments: number }
  >();
  for (const row of rows) {
    const total = totals.get(row.currency) ?? {
      gross: 0n,
      refunded: 0n,
      payments: 0,
    };
    total.gross += row.gross;
    total.refunded += row.refunded;
    total.payments += row.payments;
    totals.set(row.currency, total);
  }
  const live = subscriptions.filter((s) =>
    ["active", "past_due", "cancel_requested", "cancelling"].includes(s.state),
  );
  return {
    from: iso(from),
    to: iso(to),
    revenue: {
      byDay: rows.map((row) => ({
        day: row.day,
        currency: row.currency,
        gross: money(row.gross, row.currency),
        refunded: money(row.refunded, row.currency),
        net: money(row.gross - row.refunded, row.currency),
        payments: row.payments,
      })),
      totals: [...totals.entries()].sort().map(([currency, total]) => ({
        currency,
        gross: money(total.gross, currency),
        refunded: money(total.refunded, currency),
        net: money(total.gross - total.refunded, currency),
        payments: total.payments,
      })),
    },
    activeSubscriptions: {
      total: live.length,
      byProduct: live.length
        ? [{ productKey: "battleship-premium", count: live.length }]
        : [],
    },
    conversion: products.map((p) => {
      const created = orders.filter(
        (o) =>
          o.productKey === p.key &&
          Date.parse(o.createdAt) >= from &&
          Date.parse(o.createdAt) < to,
      );
      return {
        productKey: p.key,
        checkouts: created.length,
        paid: created.filter(
          (o) => o.status === "paid" || o.status === "refunded",
        ).length,
        failed: created.filter((o) => o.status === "failed").length,
        pending: created.filter((o) => o.status === "pending").length,
      };
    }),
  };
});
route("POST", "/payments/v1/admin/grants", (req) => {
  const persona = need(req, "grants.assign");
  const reason = reasonOf(req.body);
  const body = req.body ?? {};
  const userId = String(body.userId ?? "");
  if (!users.some((u) => u.id === userId))
    fail(400, "VALIDATION_FAILED", { userId: ["unknown"] });
  if (
    payGrants.some(
      (g) =>
        g.userId === userId &&
        g.service === body.service &&
        g.feature === body.feature &&
        g.sourceType === "manual" &&
        g.state === "active",
    )
  )
    fail(409, "CONFLICT");
  const grant: PayGrant = {
    id: uuid(),
    userId,
    service: String(body.service),
    feature: String(body.feature),
    sourceType: "manual",
    sourceId: uuid(),
    state: "active",
    validFrom: iso(Date.now()),
    validUntil: (body.validUntil as string | undefined) ?? null,
    version: 1,
    reason,
    grantedBy: actorOf(persona),
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
  };
  payGrants.push(grant);
  const list = identityGrants.get(userId) ?? [];
  list.push({
    grantId: grant.id,
    service: grant.service,
    feature: grant.feature,
    sourceType: "manual",
    validUntil: grant.validUntil,
  });
  identityGrants.set(userId, list);
  paymentsAudit.push({
    id: uuid(),
    actorId: actorOf(persona),
    action: "grant.created",
    targetType: "grant",
    targetId: grant.id,
    reason,
    data: {},
    requestId: null,
    createdAt: iso(Date.now()),
  });
  return grantView(grant);
});
route("POST", "/payments/v1/admin/grants/:id/revoke", (req, _res, [id]) => {
  const persona = need(req, "grants.assign");
  const reason = reasonOf(req.body);
  const grant = (payGrants.find((g) => g.id === id) ??
    fail(404, "NOT_FOUND")) as PayGrant;
  if (grant.state !== "active")
    fail(422, "UNPROCESSABLE", { grantId: [`grant is ${grant.state}`] });
  grant.state = "revoked";
  grant.revokedAt = iso(Date.now());
  grant.revokedBy = actorOf(persona);
  grant.revokeReason = reason;
  grant.version++;
  identityGrants.set(
    grant.userId,
    (identityGrants.get(grant.userId) ?? []).filter(
      (g) => g.grantId !== grant.id,
    ),
  );
  paymentsAudit.push({
    id: uuid(),
    actorId: actorOf(persona),
    action: "grant.revoked",
    targetType: "grant",
    targetId: grant.id,
    reason,
    data: {},
    requestId: null,
    createdAt: iso(Date.now()),
  });
  return grantView(grant);
});
route(
  "POST",
  "/payments/v1/admin/subscriptions/:id/cancel",
  (req, _res, [id]) => {
    const persona = need(req, "subscriptions.cancel");
    const reason = reasonOf(req.body);
    const s = (subscriptions.find((x) => x.id === id) ??
      fail(404, "NOT_FOUND")) as Subscription;
    if (s.state !== "active" && s.state !== "past_due")
      fail(422, "UNPROCESSABLE");
    s.state = "cancel_requested";
    s.autoRenew = false;
    s.cancelRequestedAt = iso(Date.now());
    paymentsAudit.push({
      id: uuid(),
      actorId: actorOf(persona),
      action: "subscription.cancel",
      targetType: "subscription",
      targetId: s.id,
      reason,
      data: {},
      requestId: null,
      createdAt: iso(Date.now()),
    });
    return subscriptionView(s);
  },
);
route(
  "POST",
  "/payments/v1/admin/payments/:id/refund-request",
  (req, _res, [id]) => {
    const persona = need(req, "refunds.request");
    const reason = reasonOf(req.body);
    const p = (payments.find((x) => x.id === id) ??
      fail(404, "NOT_FOUND")) as Payment;
    if (p.state !== "confirmed") fail(422, "UNPROCESSABLE");
    const refund: Refund = {
      id: uuid(),
      kind: "refund",
      state: "requested",
      providerRef: null,
      paymentId: p.id,
      userId: p.userId,
      refundType: "full",
      currency: p.currency,
      amount: p.amount,
      reason,
      evidence: {},
      requestedBy: actorOf(persona),
      createdAt: iso(Date.now()),
      updatedAt: iso(Date.now()),
    };
    refunds.unshift(refund);
    paymentsAudit.push({
      id: uuid(),
      actorId: actorOf(persona),
      action: "refund.requested",
      targetType: "payment",
      targetId: p.id,
      reason,
      data: {},
      requestId: null,
      createdAt: iso(Date.now()),
    });
    return refundView(refund);
  },
);
route("POST", "/payments/v1/admin/refunds/:id/match", (req, _res, [id]) => {
  const persona = need(req, "refunds.request");
  const reason = reasonOf(req.body);
  const refund = (refunds.find((x) => x.id === id) ??
    fail(404, "NOT_FOUND")) as Refund;
  const payment =
    payments.find((p) => p.id === req.body?.paymentId) ??
    fail(422, "UNPROCESSABLE", { paymentId: ["unknown"] });
  refund.paymentId = (payment as Payment).id;
  refund.userId = (payment as Payment).userId;
  refund.state = "recorded";
  refund.updatedAt = iso(Date.now());
  paymentsAudit.push({
    id: uuid(),
    actorId: actorOf(persona),
    action: "refund.matched",
    targetType: "refund",
    targetId: refund.id,
    reason,
    data: {},
    requestId: null,
    createdAt: iso(Date.now()),
  });
  return { refund: refundView(refund), outcome: null };
});

// ── Server ──────────────────────────────────────────────────────────────

const serviceOf = (path: string) => path.split("/")[1] ?? "";

const server = createServer(async (incoming, res) => {
  const req = incoming as Req;
  const url = new URL(req.url ?? "/", "http://localhost");
  req.query = url.searchParams;
  req.path = url.pathname;
  const agent = String(req.headers["user-agent"] ?? "");
  const service = serviceOf(req.path);
  const trace = /fake-trace=([\w-]+)/.exec(agent)?.[1];
  if (trace && service !== "__trace") {
    const calls = traces.get(trace) ?? [];
    calls.push(`${req.method} ${req.path}`);
    traces.set(trace, calls);
  }
  if (agent.includes(`fake-down=${service}`)) {
    req.socket.destroy();
    return;
  }
  if (agent.includes(`fake-fail=${service}`)) {
    if (req.path.endsWith("/health/deep"))
      send(res, 503, terminus(false, ["postgres", "valkey", "rabbitmq"]));
    else send(res, 503);
    return;
  }
  if (agent.includes(`fake-error=${service}`)) {
    if (req.path.endsWith("/health/deep"))
      send(res, 503, terminus(false, ["postgres", "valkey", "rabbitmq"]));
    else send(res, 503, errorBody("DEPENDENCY_UNAVAILABLE"));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw) {
    try {
      req.body = JSON.parse(raw);
    } catch {
      send(res, 400, errorBody("VALIDATION_FAILED"));
      return;
    }
  }
  const match = routes.find(
    (entry) => entry.method === req.method && entry.pattern.test(req.path),
  );
  if (!match) {
    send(res, 404, errorBody("NOT_FOUND"));
    return;
  }
  try {
    const params = (req.path.match(match.pattern) ?? [])
      .slice(1)
      .map(decodeURIComponent);
    const result = await match.handler(req, res, params);
    if (!res.headersSent) send(res, 200, result);
  } catch (error) {
    if (error instanceof HttpError)
      send(res, error.status, errorBody(error.code, error.fieldErrors));
    else {
      console.error(error);
      send(res, 500, errorBody("INTERNAL"));
    }
  }
});

server.listen(PORT, () => {
  console.log(
    `fake platform on http://localhost:${PORT} (${users.length} users, ${deliveries.length} deliveries, ${matches.length} matches, ${orders.length} orders, ${readings.length} readings)`,
  );
});
