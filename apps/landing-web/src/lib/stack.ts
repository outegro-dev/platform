// The /stack page: technologies grouped by job. Names and live links are
// data; what each one does in the platform is copy in messages
// (stackPage.groups.<group>, stackPage.items.<item>, stackPage.names.<item>).

export type LiveLink = { label: string; href: string };
export type StackItem = {
  id: string;
  /** Product name; when absent the name is translated (stackPage.names). */
  name?: string;
  links?: LiveLink[];
};
export type StackGroup = { id: string; items: StackItem[] };

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

export const stackGroups: StackGroup[] = [
  {
    id: "frontend",
    items: [
      { id: "next", name: "Next.js 16", links: [site, id, game] },
      { id: "react", name: "React 19" },
      { id: "typescript", name: "TypeScript 6" },
      { id: "ui", name: "Tailwind CSS 4 · Radix UI" },
      { id: "intl", name: "next-intl" },
      { id: "mobx", name: "MobX", links: [game] },
      { id: "three", name: "Three.js · React Three Fiber", links: [site] },
    ],
  },
  {
    id: "backend",
    items: [
      { id: "node", name: "Node.js 24" },
      { id: "nest", name: "NestJS 12" },
      { id: "zod", name: "Zod 4" },
      { id: "jwt", name: "jose · ES256 JWT" },
      { id: "ws", name: "WebSocket · ws", links: [game] },
      { id: "bff" },
      { id: "lava", name: "Lava", links: [shop] },
      { id: "email", name: "Resend · React Email" },
      { id: "telegram", name: "grammY" },
      { id: "google", links: [id] },
    ],
  },
  {
    id: "data",
    items: [
      { id: "postgres", name: "PostgreSQL 18 · CloudNativePG" },
      { id: "drizzle", name: "Drizzle ORM" },
      { id: "valkey", name: "Valkey 9" },
    ],
  },
  {
    id: "messaging",
    items: [{ id: "rabbitmq", name: "RabbitMQ 4" }, { id: "outbox" }],
  },
  {
    id: "delivery",
    items: [
      { id: "k3s", name: "K3s" },
      { id: "cloudflare", name: "Cloudflare" },
      { id: "traefik", name: "Traefik · cert-manager" },
      { id: "argo", name: "Argo CD" },
      { id: "actions", name: "GitHub Actions · GHCR" },
      { id: "docker", name: "Docker Buildx Bake" },
      { id: "sealed", name: "Sealed Secrets" },
      { id: "monorepo", name: "pnpm · Turborepo" },
    ],
  },
  {
    id: "observability",
    items: [
      { id: "prometheus", name: "Prometheus" },
      { id: "loki", name: "Loki · Alloy" },
      { id: "pino", name: "Pino" },
      { id: "watchdog" },
    ],
  },
  {
    id: "quality",
    items: [
      { id: "vitest", name: "Vitest" },
      { id: "testcontainers", name: "Testcontainers" },
      { id: "playwright", name: "Playwright" },
      { id: "axe", name: "axe-core" },
      { id: "biome", name: "Biome" },
    ],
  },
  {
    id: "ai",
    items: [
      { id: "agents", name: "Claude Code · Codex" },
      { id: "context7", name: "Context7 · MCP" },
      { id: "gate" },
    ],
  },
];
