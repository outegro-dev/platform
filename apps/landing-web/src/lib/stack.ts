// The /stack page, served as a restaurant menu: technologies are dishes in
// menu sections, plus a deck of trading cards for the key ones. Names, joke
// prices, stats and live links are data; everything said about a dish is
// copy in messages (stackPage.sections.<section>, stackPage.items.<dish> for
// what it really does, stackPage.jokes.<dish>, stackPage.prices.<price>,
// stackPage.names.<dish>, stackPage.trumps.cards.<card>).

export type LiveLink = { label: string; href: string };

/** Joke prices, shared by the dishes (stackPage.prices). */
export type Price =
  | "oss"
  | "nerves"
  | "priceless"
  | "house"
  | "tokens"
  | "cut"
  | "market"
  | "sleep"
  | "coffee";

export type Dish = {
  id: string;
  /** Product name; when absent the name is translated (stackPage.names). */
  name?: string;
  price: Price;
  links?: LiveLink[];
};
export type MenuSection = { id: string; dishes: Dish[] };

const site = { label: "outegro.dev", href: "https://outegro.dev" };
const id = { label: "id.outegro.dev", href: "https://id.outegro.dev" };
const game = {
  label: "battleship.outegro.dev",
  href: "https://battleship.outegro.dev",
};
const shop = {
  label: "battleship.outegro.dev/shop",
  href: "https://battleship.outegro.dev/shop",
};
const edu = { label: "edu.outegro.dev", href: "https://edu.outegro.dev" };

export const menu: MenuSection[] = [
  {
    id: "frontend",
    dishes: [
      {
        id: "next",
        name: "Next.js 16",
        price: "nerves",
        links: [site, id, game, edu],
      },
      { id: "react", name: "React 19", price: "oss" },
      { id: "typescript", name: "TypeScript 6", price: "oss" },
      { id: "ui", name: "Tailwind CSS 4 · Radix UI", price: "oss" },
      { id: "intl", name: "next-intl", price: "oss" },
      { id: "mobx", name: "MobX", price: "oss", links: [game] },
      {
        id: "three",
        name: "Three.js · React Three Fiber",
        price: "oss",
        links: [site],
      },
      { id: "sqljs", name: "sql.js · Web Worker", price: "oss", links: [edu] },
    ],
  },
  {
    id: "backend",
    dishes: [
      { id: "node", name: "Node.js 24", price: "oss" },
      { id: "nest", name: "NestJS 12", price: "oss" },
      { id: "zod", name: "Zod 4", price: "oss" },
      { id: "jwt", name: "jose · ES256 JWT", price: "oss" },
      { id: "ws", name: "WebSocket · ws", price: "oss", links: [game] },
      { id: "bff", price: "house" },
      { id: "lava", name: "Lava", price: "cut", links: [shop] },
      { id: "email", name: "Resend · React Email", price: "market" },
      { id: "telegram", name: "grammY", price: "oss" },
      { id: "google", price: "market", links: [id] },
      {
        id: "passkeys",
        name: "Passkeys · WebAuthn",
        price: "oss",
        links: [id],
      },
      { id: "assist", price: "tokens", links: [edu] },
    ],
  },
  {
    id: "data",
    dishes: [
      {
        id: "postgres",
        name: "PostgreSQL 18 · CloudNativePG",
        price: "priceless",
      },
      { id: "drizzle", name: "Drizzle ORM", price: "oss" },
      { id: "valkey", name: "Valkey 9", price: "oss" },
    ],
  },
  {
    id: "messaging",
    dishes: [
      { id: "rabbitmq", name: "RabbitMQ 4", price: "oss" },
      { id: "outbox", price: "house" },
    ],
  },
  {
    id: "delivery",
    dishes: [
      { id: "k3s", name: "K3s", price: "sleep" },
      { id: "cloudflare", name: "Cloudflare", price: "market" },
      { id: "traefik", name: "Traefik · cert-manager", price: "oss" },
      { id: "argo", name: "Argo CD", price: "oss" },
      { id: "actions", name: "GitHub Actions · GHCR", price: "market" },
      { id: "docker", name: "Docker Buildx Bake", price: "oss" },
      { id: "sealed", name: "Sealed Secrets", price: "priceless" },
      { id: "monorepo", name: "pnpm · Turborepo", price: "oss" },
    ],
  },
  {
    id: "observability",
    dishes: [
      { id: "prometheus", name: "Prometheus", price: "oss" },
      { id: "grafana", name: "Grafana", price: "oss" },
      { id: "loki", name: "Loki · Alloy", price: "oss" },
      { id: "pino", name: "Pino", price: "oss" },
      { id: "watchdog", price: "house" },
    ],
  },
  {
    id: "quality",
    dishes: [
      { id: "vitest", name: "Vitest", price: "oss" },
      { id: "testcontainers", name: "Testcontainers", price: "coffee" },
      { id: "playwright", name: "Playwright", price: "nerves" },
      { id: "axe", name: "axe-core", price: "oss" },
      { id: "biome", name: "Biome", price: "oss" },
    ],
  },
  {
    id: "ai",
    dishes: [
      { id: "agents", name: "Claude Code · Codex", price: "tokens" },
      { id: "context7", name: "Context7 · MCP", price: "tokens" },
      { id: "gate", price: "house" },
    ],
  },
];

/**
 * The trading-card stats, out of 100 and made up on purpose. For upgrade pain
 * and night calls the lower number wins (the rules say so on the page).
 */
export const trumpStats = [
  "reliability",
  "speed",
  "upgradePain",
  "logs",
  "nightCalls",
] as const;
export type TrumpStat = (typeof trumpStats)[number];

/** Header band of a card; every tone keeps its text at AA contrast. */
export type TrumpTone = "yellow" | "blue" | "pink" | "red" | "ink" | "deep";

export type TrumpCard = {
  /** A dish id; role, short fact and weak spot are stackPage.trumps.cards.<id>. */
  id: string;
  name: string;
  tone: TrumpTone;
  stats: Record<TrumpStat, number>;
};

const card = (
  id: string,
  name: string,
  tone: TrumpTone,
  [reliability, speed, upgradePain, logs, nightCalls]: [
    number,
    number,
    number,
    number,
    number,
  ],
): TrumpCard => ({
  id,
  name,
  tone,
  stats: { reliability, speed, upgradePain, logs, nightCalls },
});

// reliability, speed, upgrade pain, log appearances, night calls
export const trumpDeck: TrumpCard[] = [
  card("next", "Next.js 16", "yellow", [88, 90, 97, 55, 12]),
  card("typescript", "TypeScript 6", "blue", [96, 62, 35, 3, 1]),
  card("postgres", "PostgreSQL 18", "pink", [99, 84, 70, 30, 6]),
  card("valkey", "Valkey 9", "red", [92, 99, 12, 18, 4]),
  card("rabbitmq", "RabbitMQ 4", "deep", [93, 78, 50, 72, 14]),
  card("k3s", "K3s", "ink", [86, 74, 64, 48, 22]),
  card("playwright", "Playwright", "yellow", [81, 41, 28, 88, 9]),
  card("agents", "Claude Code · Codex", "blue", [74, 98, 18, 35, 0]),
];
