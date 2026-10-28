import {
  type BankCase,
  type CategoryId,
  categoryIds,
  type Profile,
  profileSchema,
  type Requirement,
  type VacancyAnalysis,
  type VacancyFields,
} from "@outegro/contracts/atelier";

/*
 * A made-up candidate for the tests: Jordan Vale and five invented
 * companies. Nothing here describes a real person or employer.
 */

type CaseSpec = {
  title: string;
  technologies: string[];
  ratings: Partial<Record<CategoryId, number>>;
  variants: [string, string, string];
  metrics?: string[];
  projectId?: string;
  theme?: string;
  group?: string;
  active?: boolean;
  whenVacancyMentions?: string[];
};

const companyOf: Record<string, string> = {
  N: "northwind",
  L: "lumen",
  C: "cargo",
  S: "signal",
};

export function bankCase(id: string, spec: CaseSpec): BankCase {
  const companyId = companyOf[id.replace(/\d+$/, "")] ?? "northwind";
  const ratings = Object.fromEntries(
    categoryIds.map((category) => [category, spec.ratings[category] ?? 0]),
  ) as Record<CategoryId, number>;
  const [full, compact, minimal] = spec.variants;
  return {
    id,
    companyId,
    active: spec.active ?? true,
    title: spec.title,
    projectId: spec.projectId ?? `${companyId}-${id.toLowerCase()}`,
    achievementGroupId: spec.group ?? id,
    primaryTheme: spec.theme ?? `theme-${id.toLowerCase()}`,
    secondaryThemes: [],
    technologies: spec.technologies,
    ...(spec.whenVacancyMentions
      ? { whenVacancyMentions: spec.whenVacancyMentions }
      : {}),
    capabilities: [{ id: `${id}:delivery`, name: "delivery" }],
    categoryRatings: ratings,
    keyClaims: [{ id: `${id}:core`, text: full }],
    metricClaims: (spec.metrics ?? []).map((text, index) => ({
      id: `${id}:metric_${index + 1}`,
      text,
    })),
    variants: { full, compact, minimal },
  };
}

export const cases: BankCase[] = [
  bankCase("N1", {
    title: "B2B ordering portal",
    technologies: ["Next.js", "NestJS", "PostgreSQL"],
    ratings: { FE: 3, BE: 3, AR: 4, OW: 5, EE: 5, UX: 3, CO: 2, QA: 2 },
    metrics: ["3 months"],
    variants: [
      "Led delivery of a **B2B ordering portal** on Next.js, NestJS and PostgreSQL, from requirements and API design to production support; the new channel reached profitability in about 3 months.",
      "Led a B2B ordering portal on Next.js, NestJS and PostgreSQL from API design to production; it reached profitability in about 3 months.",
      "Delivered a B2B ordering portal that reached profitability in about 3 months.",
    ],
  }),
  bankCase("N2", {
    title: "Operations console",
    technologies: ["React", "TypeScript", "Node.js"],
    ratings: { FE: 4, BE: 3, AR: 3, UX: 4, OW: 3, EE: 3 },
    variants: [
      "Merged three back-office workflows into one operations console with shared validation and business rules, so support staff learned a single tool instead of three.",
      "Merged three back-office workflows into one operations console with shared validation rules.",
      "Merged three back-office workflows into one operations console.",
    ],
  }),
  bankCase("N3", {
    title: "QR payments",
    technologies: ["Stripe", "Node.js", "PostgreSQL"],
    ratings: { BE: 5, RE: 4, SE: 3, AR: 3, QA: 2 },
    variants: [
      "Added a QR payment method to the Stripe payment service with asynchronous confirmation, webhook handling and idempotent updates, so retries never charged a customer twice.",
      "Added QR payments to the Stripe service with asynchronous confirmation, webhooks and idempotent updates.",
      "Added QR payments with webhooks and idempotent updates.",
    ],
  }),
  bankCase("N4", {
    title: "Event processing",
    technologies: ["RabbitMQ", "Redis", "Node.js"],
    ratings: { BE: 5, RE: 5, AR: 4, PF: 3 },
    variants: [
      "Rebuilt external event handling on RabbitMQ with idempotency keys and stored execution state in Redis, so duplicates and retries no longer repeated a business operation.",
      "Rebuilt event handling on RabbitMQ with idempotency keys and stored state, so retries never repeated an operation.",
      "Made RabbitMQ event handling idempotent with stored execution state.",
    ],
  }),
  bankCase("N5", {
    title: "Product editor",
    technologies: ["React", "TypeScript", "Canvas"],
    ratings: { FE: 5, PF: 4, UX: 4, QA: 2 },
    projectId: "northwind-editor",
    variants: [
      "Reworked the product editor's canvas state in React and TypeScript with undo history and incremental rendering, keeping large designs responsive while customers edited them.",
      "Reworked the editor's canvas state with undo history and incremental rendering for large designs.",
      "Reworked editor canvas state with undo history.",
    ],
  }),
  bankCase("N6", {
    title: "Catalog rendering",
    technologies: ["Next.js", "Redis"],
    ratings: { FE: 4, PF: 4, BE: 2, RE: 2 },
    variants: [
      "Moved the public catalog to server rendering in Next.js with a Redis cache for shared data and client rendering for personal data, cutting page weight for search traffic.",
      "Moved the catalog to Next.js server rendering with a Redis cache for shared data.",
      "Server-rendered the catalog with a Redis cache.",
    ],
  }),
  bankCase("N7", {
    title: "Release checks",
    technologies: ["GitHub Actions", "Playwright"],
    ratings: { QA: 5, CO: 4, OW: 3 },
    variants: [
      "Introduced pull request checks with GitHub Actions and Playwright smoke tests, and ran code review for a team of four, which made releases routine instead of risky.",
      "Introduced GitHub Actions checks with Playwright smoke tests and led code review.",
      "Introduced CI checks and led code review.",
    ],
  }),
  bankCase("N8", {
    title: "Companion app",
    technologies: ["React Native", "Expo"],
    ratings: { FE: 4, UX: 3, EE: 3 },
    whenVacancyMentions: ["mobile app", "React Native", "iOS", "Android"],
    variants: [
      "Shipped the first React Native companion app with Expo, sharing API clients with the web storefront and publishing releases to both app stores.",
      "Shipped a React Native companion app with Expo that shares API clients with the web.",
      "Shipped a React Native companion app.",
    ],
  }),
  bankCase("N9", {
    title: "Landing pages",
    technologies: ["jQuery"],
    ratings: { FE: 2 },
    active: false,
    variants: [
      "Maintained the old marketing landing pages and their contact forms for the regional sales team.",
      "Maintained the old marketing landing pages and contact forms.",
      "Maintained the old landing pages.",
    ],
  }),
  bankCase("L1", {
    title: "Notification setup wizard",
    technologies: ["React", "Redux Toolkit"],
    ratings: { FE: 5, UX: 5, OW: 3, EE: 2 },
    metrics: ["under 5 minutes"],
    variants: [
      "Rebuilt the lead notification setup as a guided wizard in React and Redux Toolkit, cutting setup time from 30+ minutes to under 5 minutes for new accounts.",
      "Rebuilt notification setup as a React wizard, cutting setup from 30+ minutes to under 5 minutes.",
      "Cut notification setup from 30+ minutes to under 5 minutes.",
    ],
  }),
  bankCase("L2", {
    title: "Webhook ordering",
    technologies: ["Node.js", "PostgreSQL"],
    ratings: { BE: 5, RE: 4, AR: 3 },
    variants: [
      "Fixed out-of-order webhook processing with event versions and idempotent updates in Node.js and PostgreSQL, so contact records stopped flipping back to stale states.",
      "Fixed out-of-order webhooks with event versions and idempotent updates.",
      "Fixed out-of-order webhooks with event versions.",
    ],
  }),
  bankCase("L3", {
    title: "Messaging providers",
    technologies: ["Node.js", "TypeScript"],
    ratings: { BE: 4, AR: 4, EE: 3 },
    variants: [
      "Put two messaging providers behind one TypeScript contract in Node.js, so the inbox, retries and delivery receipts worked the same for every channel.",
      "Put two messaging providers behind one TypeScript contract with shared retries.",
      "Unified two messaging providers behind one contract.",
    ],
  }),
  bankCase("L4", {
    title: "Async interface state",
    technologies: ["React", "TanStack Query"],
    ratings: { FE: 4, PF: 3, UX: 3 },
    variants: [
      "Replaced hand-written loading flags with TanStack Query caching and optimistic updates in React, removing a class of stale list bugs across the deals screens.",
      "Replaced loading flags with TanStack Query caching and optimistic updates.",
      "Moved async state to TanStack Query.",
    ],
  }),
  bankCase("L5", {
    title: "Permissions",
    technologies: ["Node.js", "PostgreSQL"],
    ratings: { SE: 5, BE: 4, AR: 3 },
    variants: [
      "Designed role-based permissions for shared pipelines in Node.js and PostgreSQL, checked on the server for every request and reflected in the interface.",
      "Designed role-based permissions checked on the server for every request.",
      "Designed role-based server-side permissions.",
    ],
  }),
  bankCase("C1", {
    title: "Checkout BFF",
    technologies: ["Node.js", "GraphQL"],
    ratings: { BE: 4, PF: 4, AR: 3, EE: 3 },
    variants: [
      "Built a checkout backend-for-frontend in Node.js that turned 7 service calls into 2 browser requests, keeping the payment step fast on slow mobile networks.",
      "Built a checkout BFF in Node.js that turned 7 service calls into 2 browser requests.",
      "Turned 7 checkout calls into 2 requests with a BFF.",
    ],
  }),
  bankCase("C2", {
    title: "Delivery selection",
    technologies: ["React", "Google Maps"],
    ratings: { FE: 4, UX: 4, EE: 2 },
    variants: [
      "Built delivery selection in React with an address map and pickup points, so customers across five countries chose where to receive orders in one step.",
      "Built delivery selection in React with an address map and pickup points.",
      "Built map-based delivery selection.",
    ],
  }),
  bankCase("C3", {
    title: "Carrier integrations",
    technologies: ["Node.js", "AWS"],
    ratings: { BE: 4, RE: 5, AR: 3 },
    variants: [
      "Isolated slow carrier APIs behind an integration layer on AWS with timeouts, a circuit breaker and bounded retries, so one carrier outage no longer stalled checkout.",
      "Isolated carrier APIs behind timeouts, a circuit breaker and bounded retries.",
      "Isolated carrier APIs with a circuit breaker.",
    ],
  }),
  bankCase("C4", {
    title: "API contracts",
    technologies: ["TypeScript", "Zod"],
    ratings: { QA: 4, BE: 3, FE: 3 },
    variants: [
      "Shared TypeScript contracts with runtime validation between the storefront and services, catching payload changes in tests before they reached customers.",
      "Shared TypeScript contracts with runtime validation between storefront and services.",
      "Shared validated TypeScript contracts.",
    ],
  }),
  bankCase("C5", {
    title: "Accessible picking screens",
    technologies: ["React"],
    ratings: { FE: 4, UX: 5, QA: 3 },
    variants: [
      "Made the warehouse picking screens keyboard and screen reader friendly in React, with focus management and contrast fixes the floor staff asked for.",
      "Made warehouse picking screens accessible with focus management and contrast fixes.",
      "Made picking screens accessible.",
    ],
  }),
  bankCase("S1", {
    title: "Self-hosted inference",
    technologies: ["Python", "vLLM", "LLM"],
    ratings: { AI: 5, BE: 4, PF: 3, RE: 3 },
    variants: [
      "Deployed self-hosted LLM inference on rented GPUs with request batching and fallbacks, serving conversational content generation behind one internal API.",
      "Deployed self-hosted LLM inference with request batching behind one internal API.",
      "Deployed self-hosted LLM inference.",
    ],
  }),
  bankCase("S2", {
    title: "Policy assistant",
    technologies: ["RAG", "PostgreSQL", "pgvector"],
    ratings: { AI: 5, BE: 3, AR: 4 },
    variants: [
      "Built a RAG assistant over policy documents with pgvector retrieval and cited answers, so the support team checked rules without reading whole documents.",
      "Built a RAG assistant over policy documents with pgvector retrieval and citations.",
      "Built a RAG assistant with cited answers.",
    ],
  }),
  bankCase("S3", {
    title: "Support agent",
    technologies: ["MCP", "TypeScript"],
    ratings: { AI: 4, OW: 4, EE: 3 },
    variants: [
      "Built an MCP support agent that collects incident context, classifies issues and files reproducible reports in the tracker, which the on-call engineers review.",
      "Built an MCP support agent that classifies incidents and files reproducible reports.",
      "Built an MCP incident triage agent.",
    ],
  }),
  bankCase("S4", {
    title: "Agent workflows",
    technologies: ["TypeScript", "LangChain"],
    ratings: { AI: 4, AR: 3, OW: 3, UX: 2 },
    variants: [
      "Built an agent workflow platform with human-in-the-loop approval steps, so operators could review and correct each automated action before it ran.",
      "Built an agent workflow platform with human-in-the-loop approvals.",
      "Built human-in-the-loop agent workflows.",
    ],
  }),
];

const quota = (target: number, min: number) => ({ target, min });

export const profile: Profile = profileSchema.parse({
  person: {
    name: "Jordan Vale",
    firstName: "Jordan",
    lastName: "Vale",
    location: "Lisbon, Portugal",
    phoneDisplay: "+351 900 000 000",
    phoneDigits: "+351900000000",
    email: "jordan.vale@example.com",
    links: [{ url: "https://example.com", text: "example.com" }],
    linkedin: "https://linkedin.com/in/jordan-vale-example",
    github: "https://github.com/jordan-vale-example",
    website: "https://example.com",
  },
  headline: "Senior Full-Stack Engineer",
  stack: "TypeScript · React · Node.js · PostgreSQL",
  summary: {
    profile: {
      full: "Senior full-stack engineer with 5+ years of commercial experience building e-commerce, CRM and logistics products with TypeScript, React and Node.js, owning features from API design to production.",
      compact:
        "Senior full-stack engineer with 5+ years of commercial experience in TypeScript, React and Node.js products.",
    },
    aiTools: {
      full: "I use Codex and Claude Code for repository research, comparing approaches, focused implementation and review, and I validate every change with tests while staying responsible for architecture and production outcomes.",
      compact:
        "I use Codex and Claude Code for research and implementation, validate changes with tests and own the production result.",
    },
  },
  skills: [
    {
      label: "Languages",
      items: ["TypeScript", "JavaScript", "Python", "SQL"],
    },
    {
      label: "Frontend",
      items: [
        "React",
        "Next.js",
        "Redux Toolkit",
        "TanStack Query",
        "Tailwind CSS",
      ],
    },
    {
      label: "Backend",
      items: ["Node.js", "NestJS", "REST APIs", "GraphQL", "Webhooks"],
    },
    { label: "Data & Messaging", items: ["PostgreSQL", "Redis", "RabbitMQ"] },
    {
      label: "Cloud & DevOps",
      items: ["Docker", "Kubernetes", "AWS", "GitHub Actions"],
    },
    {
      label: "AI & Developer Tools",
      items: ["RAG", "MCP", "Claude Code", "Codex"],
    },
    { label: "Testing", items: ["Vitest", "Playwright", "Code Review"] },
  ],
  companies: [
    {
      id: "signal",
      name: "Signal Labs",
      title: "AI Engineer",
      dates: "Apr 2025 – Present",
      location: "Remote",
      description: "AI-native products built end to end.",
      order: 0,
      quota: { general: quota(0, 0), ai: quota(4, 3) },
      fixedBullets: [],
      aiOnly: true,
    },
    {
      id: "northwind",
      name: "Northwind Commerce",
      title: "Full-Stack Engineer",
      dates: "Mar 2023 – Present",
      location: "Remote",
      description:
        "E-commerce platform with internal tools and several revenue streams.",
      order: 1,
      quota: { general: quota(6, 5), ai: quota(6, 5) },
      fixedBullets: [],
      aiOnly: false,
    },
    {
      id: "lumen",
      name: "Lumen CRM",
      title: "Software Engineer",
      dates: "Feb 2021 – Feb 2023",
      location: "Lisbon",
      description: "CRM for small sales teams.",
      order: 2,
      quota: { general: quota(4, 4), ai: quota(4, 3) },
      fixedBullets: [],
      aiOnly: false,
    },
    {
      id: "cargo",
      name: "Cargo Lane",
      title: "Full-Stack Engineer",
      dates: "Jan 2019 – Jan 2021",
      location: "Remote",
      description: "Warehouse and delivery logistics.",
      order: 3,
      quota: { general: quota(4, 3), ai: quota(0, 0) },
      fixedBullets: [],
      aiOnly: false,
    },
    {
      id: "oldtown",
      name: "Oldtown Studio",
      title: "Software Engineer",
      dates: "Jan 2018 – Jan 2019",
      location: "Porto",
      description: "Web studio for small businesses.",
      order: 4,
      quota: { general: quota(0, 0), ai: quota(0, 0) },
      fixedBullets: [
        "Built service pages and internal knowledge tools for small business clients.",
      ],
      aiOnly: false,
    },
  ],
  education: [
    {
      degree: "BSc in Computer Science",
      school: "Example University",
      dates: "2014 – 2018",
    },
  ],
  languages: [
    { name: "English", level: "C1" },
    { name: "Portuguese", level: "Native" },
  ],
  factsMode: "strict",
  font: "plex",
  maxPages: 2,
  baseYears: 5,
  form: {
    location: "Lisbon, Portugal",
    timezone: "GMT+0",
    workFormat: "Remote",
    contract: "B2B contractor",
    relocation: false,
    needsSponsorship: false,
    salaryFrom: { amount: 4000, currency: "EUR", period: "month" },
    noticeWeeks: 2,
    eeo: "decline",
  },
  voice: {
    rules: [
      "Write simply, in short sentences.",
      "Never use a long dash.",
      "A smiley only in informal messages.",
    ],
    telegramTemplateRu: null,
    aboutMe: null,
  },
  bank: { bankVersion: 1, cases },
});

export const withCases = (
  list: BankCase[],
  base: Profile = profile,
): Profile => ({
  ...base,
  bank: { ...base.bank, cases: list },
});

export const req = (
  id: string,
  text: string,
  categories: CategoryId[],
  importance: Requirement["importance"] = "must",
  technologyTags: string[] = [],
  evidenceQuote = text,
): Requirement => ({
  id,
  text,
  importance,
  categoryIds: categories,
  technologyTags,
  evidenceQuote,
});

export const analysisOf = (
  requirements: Requirement[],
  extra: Partial<VacancyAnalysis> = {},
): VacancyAnalysis => ({
  company: "Acme Robotics",
  title: "Senior Frontend Engineer",
  cvRole: { senior: true, focus: "Frontend", noun: "Engineer" },
  aiCore: false,
  productQuestion: "What load does the ordering system handle today?",
  requirements,
  ...extra,
});

export const fieldsOf = (
  text: string,
  extra: Partial<VacancyFields> = {},
): VacancyFields => ({
  provider: "greenhouse",
  url: "https://boards.example.com/acme/jobs/1",
  originalUrl: null,
  applyUrl: "https://boards.example.com/acme/jobs/1/apply",
  ats: "greenhouse",
  atsBoard: "acme",
  atsJobId: "1",
  title: "Senior Frontend Engineer",
  company: "Acme Robotics",
  location: "Remote, Europe",
  remote: true,
  postedAt: null,
  salary: null,
  text: text.padEnd(120, " ."),
  ...extra,
});

/** The value, or a test failure when it is missing. */
export function defined<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`Missing ${what}`);
  return value;
}

/** A fixture case by id. */
export const caseById = (id: string) =>
  defined(
    cases.find((item) => item.id === id),
    `case ${id}`,
  );
