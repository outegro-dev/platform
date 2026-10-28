import type {
  ApplicationCard,
  ApplicationDetail,
  ApplicationFlag,
  ApplicationStage,
  ArchiveReason,
  AtelierTaskType,
  ChannelKind,
  LlmProviderStatus,
  PipelineOverview,
} from "@outegro/contracts/atelier";
import type { ProfileSummary } from "./schemas";

/*
 * Made-up data for mock mode (ATELIER_API_URL=mock): invented companies,
 * people and links (`.example` domains), nothing about the real owner. It
 * is shaped exactly like atelier-backend's answers and checked against the
 * contract schemas in mock.test.ts.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A deterministic generator, so every start shows the same board. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A version 4 UUID from the generator. */
export function mockUuid(random: () => number): string {
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(random() * 16).toString(16),
  );
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Math.floor(random() * 4)] ?? "8";
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

type Focus = "backend" | "frontend" | "fullstack" | "ai";

type Seed = {
  company: string;
  role: string;
  focus: Focus;
  stage: ApplicationStage;
  score: number | null;
  source: string;
  location: string | null;
  channel: ChannelKind | null;
  flags?: ApplicationFlag[];
  archiveReason?: ArchiveReason;
  /** Hours since the card last changed. */
  updatedHours: number;
  /** Hours since it was sent, for cards past "ready". */
  sentHours?: number;
  opens?: number;
  salary?: { min: number; max: number; currency: string };
  /** Where the pipeline stopped, for cards still building. */
  stoppedAt?: AtelierTaskType;
};

const seeds: Seed[] = [
  // Found: below the threshold or not scored yet.
  {
    company: "Quarry Systems",
    role: "Backend Engineer (Go)",
    focus: "backend",
    stage: "found",
    score: 58,
    source: "linkedin",
    location: "Remote, EU",
    channel: null,
    updatedHours: 5,
  },
  {
    company: "Pinecrest Learning",
    role: "Frontend Engineer",
    focus: "frontend",
    stage: "found",
    score: 61,
    source: "headhunter.ge",
    location: "Hybrid, Warsaw",
    channel: null,
    updatedHours: 9,
  },
  {
    company: "Saltmarsh Games",
    role: "Full-Stack Developer, Live Ops",
    focus: "fullstack",
    stage: "found",
    score: null,
    source: "telegram",
    location: null,
    channel: null,
    updatedHours: 1,
  },
  {
    company: "Arbor Mobility",
    role: "Senior Node.js Engineer",
    focus: "backend",
    stage: "found",
    score: 63,
    source: "workable",
    location: "Remote",
    channel: null,
    updatedHours: 30,
  },
  // Fit: above the threshold, waiting to be taken (the Inbox).
  {
    company: "Northwind Labs",
    role: "Senior Full-Stack Engineer",
    focus: "fullstack",
    stage: "fit",
    score: 88,
    source: "ashby",
    location: "Remote, Europe",
    channel: "ats_form",
    updatedHours: 2,
    salary: { min: 85_000, max: 105_000, currency: "EUR" },
  },
  {
    company: "Kestrel Pay",
    role: "Senior Backend Engineer, Ledger",
    focus: "backend",
    stage: "fit",
    score: 84,
    source: "lever",
    location: "Remote, CET ±2",
    channel: "ats_form",
    updatedHours: 3,
  },
  {
    company: "Lumen Grid",
    role: "Software Engineer, Platform",
    focus: "backend",
    stage: "fit",
    score: 79,
    source: "greenhouse",
    location: "Amsterdam or remote",
    channel: "ats_form",
    updatedHours: 6,
  },
  {
    company: "Fernhill Analytics",
    role: "Senior Frontend Engineer (React)",
    focus: "frontend",
    stage: "fit",
    score: 76,
    source: "linkedin",
    location: "Remote",
    channel: "linkedin",
    updatedHours: 20,
  },
  // Building: the pipeline is on it.
  {
    company: "Tessellate",
    role: "AI Engineer, Agents",
    focus: "ai",
    stage: "building",
    score: 82,
    source: "ashby",
    location: "Remote, EU",
    channel: "ats_form",
    updatedHours: 0.2,
    stoppedAt: "adapt",
  },
  {
    company: "Halcyon Freight",
    role: "Senior Backend Engineer",
    focus: "backend",
    stage: "building",
    score: 77,
    source: "lever",
    location: "Berlin or remote",
    channel: "email",
    flags: ["needs_edit"],
    updatedHours: 4,
    stoppedAt: "fit",
  },
  {
    company: "Ridgeway Data",
    role: "Full-Stack Engineer",
    focus: "fullstack",
    stage: "building",
    score: 74,
    source: "greenhouse",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 0.5,
    stoppedAt: "compose",
  },
  // Ready: waiting for "Send".
  {
    company: "Brightline Health",
    role: "Senior Full-Stack Engineer",
    focus: "fullstack",
    stage: "ready",
    score: 86,
    source: "lever",
    location: "Remote, UK or EU",
    channel: "email",
    updatedHours: 1.5,
    salary: { min: 90_000, max: 110_000, currency: "EUR" },
  },
  {
    company: "Orbitrail",
    role: "Backend Engineer, Payments",
    focus: "backend",
    stage: "ready",
    score: 81,
    source: "ashby",
    location: "Lisbon or remote",
    channel: "ats_form",
    flags: ["needs_human"],
    updatedHours: 3,
  },
  {
    company: "Juniper Ledger",
    role: "Senior TypeScript Engineer",
    focus: "fullstack",
    stage: "ready",
    score: 79,
    source: "workable",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 7,
  },
  // Sent.
  {
    company: "Marigold Commerce",
    role: "Senior Frontend Engineer",
    focus: "frontend",
    stage: "sent",
    score: 83,
    source: "lever",
    location: "Remote, EU",
    channel: "ats_form",
    flags: ["cv_opened"],
    updatedHours: 6,
    sentHours: 50,
    opens: 2,
  },
  {
    company: "Corvid Security",
    role: "Full-Stack Engineer",
    focus: "fullstack",
    stage: "sent",
    score: 78,
    source: "greenhouse",
    location: "Remote",
    channel: "email",
    flags: ["follow_up", "dodep"],
    updatedHours: 26,
    sentHours: 9 * 24,
  },
  {
    company: "Polder Energy",
    role: "Senior Backend Engineer",
    focus: "backend",
    stage: "sent",
    score: 80,
    source: "linkedin",
    location: "Rotterdam or remote",
    channel: "linkedin",
    updatedHours: 96,
    sentHours: 96,
  },
  {
    company: "Tidewater Logistics",
    role: "Node.js Engineer",
    focus: "backend",
    stage: "sent",
    score: 75,
    source: "headhunter.ge",
    location: "Tbilisi or remote",
    channel: "telegram",
    flags: ["dodep"],
    updatedHours: 30,
    sentHours: 72,
  },
  {
    company: "Calder Studio",
    role: "Product Engineer",
    focus: "fullstack",
    stage: "sent",
    score: 72,
    source: "ashby",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 3,
    sentHours: 3,
  },
  {
    company: "Vantage Atlas",
    role: "Senior Software Engineer",
    focus: "fullstack",
    stage: "sent",
    score: 81,
    source: "workable",
    location: "Remote, EU",
    channel: "ats_form",
    updatedHours: 1,
    sentHours: 1,
  },
  // Interviews.
  {
    company: "Ostrava Robotics",
    role: "Senior Full-Stack Engineer",
    focus: "fullstack",
    stage: "hr",
    score: 85,
    source: "lever",
    location: "Prague or remote",
    channel: "email",
    flags: ["meeting"],
    updatedHours: 20,
    sentHours: 6 * 24,
    opens: 3,
  },
  {
    company: "Bellwether Insurance Tech",
    role: "Backend Engineer",
    focus: "backend",
    stage: "hr",
    score: 77,
    source: "greenhouse",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 50,
    sentHours: 8 * 24,
  },
  {
    company: "Sable & Finch",
    role: "Senior Frontend Engineer",
    focus: "frontend",
    stage: "task",
    score: 82,
    source: "ashby",
    location: "Remote, EU",
    channel: "ats_form",
    updatedHours: 28,
    sentHours: 11 * 24,
    opens: 1,
  },
  {
    company: "Glasshouse AI",
    role: "AI Product Engineer",
    focus: "ai",
    stage: "tech",
    score: 87,
    source: "ashby",
    location: "Remote",
    channel: "ats_form",
    flags: ["meeting"],
    updatedHours: 10,
    sentHours: 13 * 24,
    opens: 4,
  },
  {
    company: "Meridian Freightworks",
    role: "Senior Backend Engineer",
    focus: "backend",
    stage: "tech",
    score: 80,
    source: "lever",
    location: "Hamburg or remote",
    channel: "email",
    updatedHours: 75,
    sentHours: 16 * 24,
    opens: 2,
  },
  {
    company: "Hollis & Pike",
    role: "Staff Engineer, Platform",
    focus: "backend",
    stage: "final",
    score: 84,
    source: "greenhouse",
    location: "London or remote",
    channel: "ats_form",
    flags: ["meeting"],
    updatedHours: 22,
    sentHours: 19 * 24,
    opens: 5,
  },
  {
    company: "Kittiwake Travel",
    role: "Senior Full-Stack Engineer",
    focus: "fullstack",
    stage: "offer",
    score: 89,
    source: "lever",
    location: "Remote, EU",
    channel: "email",
    updatedHours: 8,
    sentHours: 24 * 24,
    opens: 6,
    salary: { min: 95_000, max: 115_000, currency: "EUR" },
  },
  // Archive.
  {
    company: "Driftwood Media",
    role: "Frontend Engineer",
    focus: "frontend",
    stage: "archived",
    archiveReason: "rejected",
    score: 71,
    source: "lever",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 5 * 24,
    sentHours: 12 * 24,
  },
  {
    company: "Thornbury Bank",
    role: "Senior Backend Engineer",
    focus: "backend",
    stage: "archived",
    archiveReason: "ghosted",
    score: 76,
    source: "linkedin",
    location: "Remote",
    channel: "linkedin",
    updatedHours: 2 * 24,
    sentHours: 23 * 24,
  },
  {
    company: "Quillon",
    role: "Full-Stack Engineer",
    focus: "fullstack",
    stage: "archived",
    archiveReason: "closed",
    score: 73,
    source: "workable",
    location: null,
    channel: "ats_form",
    updatedHours: 9 * 24,
  },
  {
    company: "Ember Freight",
    role: "Backend Developer",
    focus: "backend",
    stage: "archived",
    archiveReason: "skipped",
    score: 66,
    source: "headhunter.ge",
    location: "Tbilisi",
    channel: null,
    updatedHours: 3 * 24,
  },
  {
    company: "Ashgrove Labs",
    role: "AI Engineer",
    focus: "ai",
    stage: "archived",
    archiveReason: "withdrawn",
    score: 80,
    source: "ashby",
    location: "Remote",
    channel: "ats_form",
    updatedHours: 6 * 24,
    sentHours: 15 * 24,
  },
];

/* ---------- Requirements by focus ---------- */

type Req = ApplicationDetail["fit"] extends infer F
  ? F extends { requirements: (infer R)[] }
    ? R
    : never
  : never;

const requirementPool: Record<Focus, Omit<Req, "id">[]> = {
  backend: [
    {
      text: "5+ years building backend services in Node.js or Go",
      importance: "must",
      label: "direct",
      caseIds: ["BE04", "BE11"],
    },
    {
      text: "Strong PostgreSQL: schema design, indexes, query plans",
      importance: "must",
      label: "direct",
      caseIds: ["BE07"],
    },
    {
      text: "Event-driven systems with idempotent consumers",
      importance: "must",
      label: "direct",
      caseIds: ["AR02", "BE11"],
    },
    {
      text: "Kafka in production",
      importance: "preferred",
      label: "missing",
      caseIds: [],
    },
    {
      text: "Own services end to end: on-call, metrics, incident reviews",
      importance: "responsibility",
      label: "related",
      caseIds: ["OW01"],
    },
    {
      text: "Payments or ledger domain experience",
      importance: "preferred",
      label: "weak",
      caseIds: ["BE09"],
    },
    {
      text: "Design APIs used by other teams",
      importance: "responsibility",
      label: "direct",
      caseIds: ["AR05"],
    },
    {
      text: "Kubernetes and infrastructure as code",
      importance: "preferred",
      label: "related",
      caseIds: ["SE03"],
    },
  ],
  frontend: [
    {
      text: "5+ years with React and TypeScript",
      importance: "must",
      label: "direct",
      caseIds: ["FE02", "FE08"],
    },
    {
      text: "Accessibility to WCAG 2.2 AA",
      importance: "must",
      label: "direct",
      caseIds: ["UX03"],
    },
    {
      text: "Design systems shared across products",
      importance: "responsibility",
      label: "direct",
      caseIds: ["FE05"],
    },
    {
      text: "Core Web Vitals and bundle budgets",
      importance: "must",
      label: "related",
      caseIds: ["PF01"],
    },
    {
      text: "Testing with Playwright and component tests",
      importance: "responsibility",
      label: "direct",
      caseIds: ["QA02"],
    },
    {
      text: "React Native",
      importance: "preferred",
      label: "missing",
      caseIds: [],
    },
    {
      text: "Mentor other frontend engineers",
      importance: "responsibility",
      label: "weak",
      caseIds: ["CO02"],
    },
  ],
  fullstack: [
    {
      text: "TypeScript across the stack: React and Node.js",
      importance: "must",
      label: "direct",
      caseIds: ["FE02", "BE04"],
    },
    {
      text: "PostgreSQL and Redis in production",
      importance: "must",
      label: "direct",
      caseIds: ["BE07"],
    },
    {
      text: "Ship product features from idea to production",
      importance: "responsibility",
      label: "direct",
      caseIds: ["OW02", "FE05"],
    },
    {
      text: "Next.js App Router",
      importance: "preferred",
      label: "direct",
      caseIds: ["FE08"],
    },
    {
      text: "GraphQL",
      importance: "preferred",
      label: "weak",
      caseIds: ["BE02"],
    },
    {
      text: "CI/CD and observability",
      importance: "responsibility",
      label: "related",
      caseIds: ["SE03"],
    },
    {
      text: "Elixir or Phoenix",
      importance: "preferred",
      label: "missing",
      caseIds: [],
    },
    {
      text: "Work with product and design on discovery",
      importance: "responsibility",
      label: "related",
      caseIds: ["CO01"],
    },
  ],
  ai: [
    {
      text: "Build LLM features in production: tools, evals, guardrails",
      importance: "must",
      label: "direct",
      caseIds: ["AI01", "AI03"],
    },
    {
      text: "Python or TypeScript services",
      importance: "must",
      label: "direct",
      caseIds: ["BE04"],
    },
    {
      text: "Retrieval and vector search",
      importance: "must",
      label: "related",
      caseIds: ["AI02"],
    },
    {
      text: "Measure model quality with offline evals",
      importance: "responsibility",
      label: "direct",
      caseIds: ["AI03"],
    },
    {
      text: "Fine-tuning open models",
      importance: "preferred",
      label: "missing",
      caseIds: [],
    },
    {
      text: "Cost and latency budgets for model calls",
      importance: "responsibility",
      label: "direct",
      caseIds: ["AI04"],
    },
    {
      text: "Agent orchestration frameworks",
      importance: "preferred",
      label: "weak",
      caseIds: ["AI01"],
    },
  ],
};

/** Coverage points per label, as the fit step weighs them. */
const weight = { direct: 1, related: 0.6, weak: 0.3, missing: 0 } as const;

/* ---------- Pipeline steps ---------- */

const steps: { step: AtelierTaskType; llm: number; ms: number }[] = [
  { step: "fetch", llm: 0, ms: 1_840 },
  { step: "extract", llm: 0, ms: 310 },
  { step: "structure", llm: 0, ms: 95 },
  { step: "analyze", llm: 1, ms: 21_400 },
  { step: "match", llm: 0, ms: 140 },
  { step: "select", llm: 0, ms: 60 },
  { step: "compose", llm: 1, ms: 48_200 },
  { step: "adapt", llm: 1, ms: 33_900 },
  { step: "rules", llm: 0, ms: 45 },
  { step: "review", llm: 1, ms: 26_700 },
  { step: "fit", llm: 0, ms: 7_300 },
  { step: "ats-check", llm: 0, ms: 420 },
  { step: "store", llm: 0, ms: 380 },
  { step: "texts", llm: 1, ms: 18_600 },
  { step: "channel", llm: 0, ms: 2_100 },
  { step: "send", llm: 0, ms: 14_800 },
];

type StepView = ApplicationDetail["pipeline"][number];

function pipelineFor(seed: Seed): StepView[] {
  const index = (step: AtelierTaskType) =>
    steps.findIndex((s) => s.step === step);
  const view = (
    s: (typeof steps)[number],
    status: StepView["status"],
    note: string | null = null,
  ): StepView => ({
    step: s.step,
    status,
    ms: status === "ok" || status === "failed" ? s.ms : null,
    llmCalls: status === "ok" || status === "failed" ? s.llm : 0,
    note,
  });
  if (seed.stage === "found" || seed.stage === "fit") {
    const last = index("match");
    return steps.map((s, i) =>
      i <= last
        ? view(
            s,
            "ok",
            s.step === "match" ? `Score ${seed.score ?? "not set"}` : null,
          )
        : view(s, "waiting"),
    );
  }
  if (seed.stage === "building") {
    const stop = index(seed.stoppedAt ?? "compose");
    const failed = seed.flags?.includes("needs_edit");
    return steps.map((s, i) => {
      if (i < stop) return view(s, "ok");
      if (i === stop)
        return failed
          ? view(
              s,
              "failed",
              "Still 2 pages after 3 tries: shorten the About or drop a case",
            )
          : view(s, "running");
      return view(s, "waiting");
    });
  }
  if (seed.stage === "ready") {
    return steps.map((s) => {
      if (s.step === "send")
        return seed.flags?.includes("needs_human")
          ? view(s, "needs_human", "The form asks for a CAPTCHA")
          : view(s, "waiting");
      if (s.step === "fit") return view(s, "ok", "1 page, last page 86% full");
      return view(s, "ok");
    });
  }
  return steps.map((s) =>
    s.step === "repair" ? view(s, "skipped") : view(s, "ok"),
  );
}

/* ---------- Texts ---------- */

function slugOf(company: string) {
  return company
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const PERSON = "Rowan Ellery";

function cvRoleOf(focus: Focus) {
  return {
    backend: "Backend_Engineer",
    frontend: "Frontend_Engineer",
    fullstack: "Full-Stack_Engineer",
    ai: "AI_Engineer",
  }[focus];
}

function materialsFor(seed: Seed): ApplicationDetail["materials"] {
  const strengths = {
    backend: "event-driven Node.js services on PostgreSQL",
    frontend: "accessible React interfaces and a shared design system",
    fullstack: "TypeScript products from the database to the interface",
    ai: "LLM features with evals, tools and cost budgets",
  }[seed.focus];
  return [
    {
      kind: "cover_letter",
      locale: "en",
      subject: `${seed.role}, ${PERSON}`,
      body: `Hello ${seed.company} team,\n\nI'm applying for the ${seed.role} role. For the last six years I have built ${strengths}, most recently owning the checkout and ledger services at a payments company (3.1M requests a day, p99 under 180 ms).\n\nWhat drew me to ${seed.company} is the way the posting describes ownership: one team from the idea to on-call. That is how I like to work.\n\nMy CV is at the link below. I'm happy to walk through any of it on a call.\n\nBest,\n${PERSON}`,
    },
    {
      kind: "telegram",
      locale: "ru",
      subject: null,
      body: `Здравствуйте! Увидел вакансию ${seed.role} в ${seed.company}. Шесть лет делаю ${seed.focus === "frontend" ? "интерфейсы на React и TypeScript" : "сервисы на Node.js и TypeScript"}, последние два года отвечаю за платёжный контур. Резюме по ссылке. Подскажите, кому лучше написать по этой роли?`,
    },
    {
      kind: "email",
      locale: "en",
      subject: `Re: ${seed.role}`,
      body: `Hi,\n\nI applied for ${seed.role} through your careers page earlier this week and wanted to send it directly as well. A one-page CV is attached as a link.\n\nThanks for your time,\n${PERSON}`,
    },
  ];
}

function answersFor(seed: Seed): ApplicationDetail["answers"] {
  return [
    {
      question: `Why do you want to join ${seed.company}?`,
      answer: `The team owns its product end to end, and the problems in the posting (${seed.focus === "frontend" ? "a design system used by several products" : "reliable money movement at scale"}) are the ones I have spent the last years on.`,
    },
    {
      question: "What are your salary expectations?",
      answer: "From €6,500 a month gross on a B2B contract, open to discuss.",
    },
    { question: "What is your notice period?", answer: "Two weeks." },
    {
      question: "Do you require visa sponsorship?",
      answer: "No.",
    },
    {
      question: "Where are you based?",
      answer: "Valencia, Spain (CET). Remote.",
    },
  ];
}

function vacancyText(seed: Seed) {
  return `${seed.company} is hiring a ${seed.role}.\n\nAbout the team\nWe are a small product team that owns its services from the first sketch to on-call. You will work with two engineers, a designer and a product manager.\n\nWhat you will do\n- Design and build features our customers use every day\n- Own the reliability of the services you ship\n- Review code and help shape our engineering practices\n\nWhat we look for\n${requirementPool[
    seed.focus
  ]
    .map((r) => `- ${r.text}`)
    .join(
      "\n",
    )}\n\nWhat we offer\nRemote work across Europe, a learning budget, 28 days of paid leave and a home office allowance.`;
}

/* ---------- Building one application ---------- */

export type MockApplication = {
  card: ApplicationCard;
  detail: Omit<ApplicationDetail, "card">;
};

const pastReady: ApplicationStage[] = [
  "sent",
  "hr",
  "task",
  "tech",
  "final",
  "offer",
];

function buildApplication(
  seed: Seed,
  random: () => number,
  now: number,
): MockApplication {
  const id = mockUuid(random);
  const at = (hours: number) => new Date(now - hours * HOUR).toISOString();
  const sentAt = seed.sentHours !== undefined ? at(seed.sentHours) : null;
  const card: ApplicationCard = {
    id,
    company: seed.company,
    role: seed.role,
    stage: seed.stage,
    archiveReason: seed.archiveReason ?? null,
    flags: seed.flags ?? [],
    score: seed.score,
    channel: seed.channel,
    source: seed.source,
    location: seed.location,
    sentAt,
    updatedAt: at(seed.updatedHours),
  };

  const pool = requirementPool[seed.focus];
  const requirements = pool.map((r, i) => ({ ...r, id: `R${i + 1}` }));
  const fit =
    seed.score === null
      ? null
      : {
          score: seed.score,
          requirements,
        };

  const built =
    seed.stage === "ready" ||
    pastReady.includes(seed.stage) ||
    (seed.stage === "archived" && sentAt !== null);
  const slug = slugOf(seed.company);
  const fileName = `${PERSON.replace(" ", "_")}_${cvRoleOf(seed.focus)}_CV.pdf`;
  const versionId = mockUuid(random);
  const hash = Array.from(
    { length: 12 },
    () =>
      "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"[
        Math.floor(random() * 57)
      ],
  ).join("");
  const cv = built
    ? {
        versionId,
        fileName,
        pdfUrl: `/api/atelier/mock/cv/${versionId}`,
        shareUrl: sentAt ? `https://cv.outegro.dev/${hash}/${fileName}` : null,
        opens: seed.opens ?? 0,
        pages: 1,
        atsCoverage: Math.min(0.97, 0.68 + (seed.score ?? 70) / 400),
        changes: [
          `About rewritten around ${seed.focus === "frontend" ? "the design system and accessibility" : "ownership and reliability"}`,
          "3 bullets moved up: idempotent consumers, PostgreSQL tuning, on-call",
          `Skills reordered for ${seed.company}: the posting's words first`,
          "Kafka not claimed: no case in the bank",
        ],
      }
    : null;

  // The first events come before anything else that happened to the card.
  const start = Math.max(seed.updatedHours, seed.sentHours ?? 0);
  const history: ApplicationDetail["history"] = [
    {
      at: at(start + 40),
      action: "found",
      source: "system",
      details: `On ${seed.source}`,
    },
  ];
  if (seed.score !== null)
    history.push({
      at: at(start + 39.5),
      action: "scored",
      source: "system",
      details: `Fit ${seed.score} of 100`,
    });
  if (seed.stage !== "found" && seed.stage !== "fit")
    history.push({
      at: at(start + 30),
      action: "taken",
      source: "manual",
      details: "From the Inbox",
    });
  if (built)
    history.push({
      at: at((seed.sentHours ?? seed.updatedHours) + 2),
      action: "built",
      source: "system",
      details: "1 page, ATS coverage checked",
    });
  if (sentAt)
    history.push({
      at: sentAt,
      action: "sent",
      source: "system",
      details: `Through ${seed.channel ?? "manual"}`,
    });
  if (sentAt && seed.channel === "ats_form")
    history.push({
      at: at((seed.sentHours ?? 0) - 0.1),
      action: "received",
      source: "mail",
      details: "Thank you for applying",
    });
  if (seed.flags?.includes("cv_opened"))
    history.push({
      at: at(seed.updatedHours),
      action: "cv_opened",
      source: "system",
      details: "The shared CV link was opened",
    });
  if (["hr", "task", "tech", "final", "offer"].includes(seed.stage))
    history.push({
      at: at(seed.updatedHours + 4),
      action: "invited",
      source: "mail",
      details: "A call with the recruiter, from the invitation",
    });
  if (["task", "tech", "final", "offer"].includes(seed.stage))
    history.push({
      at: at(seed.updatedHours),
      action: "moved",
      source: "manual",
      details: `To ${seed.stage}`,
    });
  if (seed.stage === "archived")
    history.push({
      at: at(seed.updatedHours),
      action: "archived",
      source: seed.archiveReason === "rejected" ? "mail" : "system",
      details:
        seed.archiveReason === "rejected"
          ? "Unfortunately, we decided to move forward with other candidates"
          : seed.archiveReason === "ghosted"
            ? "21 days without a reply"
            : null,
    });
  history.sort((a, b) => b.at.localeCompare(a.at));

  const contacts: ApplicationDetail["contacts"] = [];
  if (sentAt && seed.channel)
    contacts.push({
      kind: seed.channel,
      target:
        seed.channel === "ats_form"
          ? `jobs.${seed.source}.example/${slug}`
          : seed.channel === "email"
            ? `careers@${slug}.example`
            : seed.channel === "telegram"
              ? `@${slug.replace(/-/g, "_")}_hiring`
              : `linkedin.example/in/${slug}-talent`,
      status: pastReady.slice(1).includes(seed.stage) ? "replied" : "sent",
      sentAt,
      note: "The main application",
    });
  if (seed.flags?.includes("dodep")) {
    contacts.push({
      kind: "email",
      target: `talent@${slug}.example`,
      status: "sent",
      sentAt: at((seed.sentHours ?? 0) - 48),
      note: "Dodep 2: the recruiter's address from the careers page",
    });
    contacts.push({
      kind: "telegram",
      target: `@${slug.split("-")[0]}_recruiting`,
      status: "draft",
      sentAt: null,
      note: "Dodep 3: waits for the batch",
    });
  }

  return {
    card,
    detail: {
      vacancy: {
        title: seed.role,
        company: seed.company,
        location: seed.location,
        url: `https://jobs.${seed.source}.example/${slug}/${id.slice(0, 8)}`,
        applyUrl:
          seed.channel === "ats_form"
            ? `https://jobs.${seed.source}.example/${slug}/${id.slice(0, 8)}/apply`
            : null,
        salary: seed.salary
          ? {
              min: seed.salary.min,
              max: seed.salary.max,
              currency: seed.salary.currency,
              period: "year",
            }
          : null,
        text: vacancyText(seed),
      },
      fit,
      cv,
      materials: built || seed.stage === "building" ? materialsFor(seed) : [],
      answers: built ? answersFor(seed) : [],
      contacts,
      history,
      pipeline: pipelineFor(seed),
    },
  };
}

/** A fit score from the requirements, as the fit step computes it. */
export function scoreOf(requirements: { label: keyof typeof weight }[]) {
  if (!requirements.length) return 0;
  const sum = requirements.reduce((acc, r) => acc + weight[r.label], 0);
  return Math.round((sum / requirements.length) * 100);
}

/* ---------- The rest of the mock ---------- */

export type MockState = {
  now: number;
  random: () => number;
  applications: MockApplication[];
  providers: LlmProviderStatus[];
  jobs: PipelineOverview["jobs"];
  queues: PipelineOverview["queues"];
  profile: ProfileSummary;
  unsortedMail: { applicationId: string; reason: string }[];
};

export function createMockState(now = Date.now()): MockState {
  const random = seeded(20261028);
  const applications = seeds.map((seed) => buildApplication(seed, random, now));
  const at = (hours: number) => new Date(now - hours * HOUR).toISOString();
  const byCompany = (company: string) =>
    applications.find((a) => a.card.company === company)?.card.id ?? null;

  const jobs: PipelineOverview["jobs"] = [
    {
      id: mockUuid(random),
      kind: "application.build",
      applicationId: byCompany("Tessellate"),
      title: "Tessellate, AI Engineer, Agents",
      step: "adapt",
      status: "running",
      startedAt: at(0.3),
      updatedAt: at(0.02),
    },
    {
      id: mockUuid(random),
      kind: "application.build",
      applicationId: byCompany("Ridgeway Data"),
      title: "Ridgeway Data, Full-Stack Engineer",
      step: "compose",
      status: "running",
      startedAt: at(0.6),
      updatedAt: at(0.05),
    },
    {
      id: mockUuid(random),
      kind: "application.build",
      applicationId: byCompany("Halcyon Freight"),
      title: "Halcyon Freight, Senior Backend Engineer",
      step: "fit",
      status: "failed",
      startedAt: at(4.5),
      updatedAt: at(4),
    },
    {
      id: mockUuid(random),
      kind: "application.send",
      applicationId: byCompany("Orbitrail"),
      title: "Orbitrail, Backend Engineer, Payments",
      step: "send",
      status: "waiting_human",
      startedAt: at(3.2),
      updatedAt: at(3),
    },
    {
      id: mockUuid(random),
      kind: "discover",
      applicationId: null,
      title: "Discover: Lever, Ashby, Greenhouse boards",
      step: "discover",
      status: "queued",
      startedAt: at(0.1),
      updatedAt: at(0.1),
    },
    {
      id: mockUuid(random),
      kind: "application.dodep",
      applicationId: byCompany("Corvid Security"),
      title: "Corvid Security, Full-Stack Engineer",
      step: "dodep",
      status: "queued",
      startedAt: at(1.2),
      updatedAt: at(1.2),
    },
    {
      id: mockUuid(random),
      kind: "application.send",
      applicationId: byCompany("Vantage Atlas"),
      title: "Vantage Atlas, Senior Software Engineer",
      step: "send",
      status: "done",
      startedAt: at(1.4),
      updatedAt: at(1),
    },
    {
      id: mockUuid(random),
      kind: "mail",
      applicationId: null,
      title: "Mail: 14 new messages read",
      step: "mail",
      status: "done",
      startedAt: at(0.25),
      updatedAt: at(0.24),
    },
  ];

  const busy: Partial<Record<string, [number, number]>> = {
    discover: [1, 0],
    fetch: [3, 1],
    analyze: [2, 1],
    compose: [1, 1],
    adapt: [0, 1],
    review: [1, 0],
    texts: [1, 0],
    dodep: [1, 0],
    mail: [0, 0],
  };
  const queueTypes: PipelineOverview["queues"][number]["type"][] = [
    "discover",
    "fetch",
    "extract",
    "dedupe",
    "structure",
    "analyze",
    "match",
    "select",
    "compose",
    "adapt",
    "rules",
    "review",
    "repair",
    "fallback",
    "fit",
    "ats-check",
    "store",
    "texts",
    "channel",
    "send",
    "dodep",
    "mail",
  ];
  const queues = queueTypes.map((type) => ({
    type,
    waiting: busy[type]?.[0] ?? 0,
    running: busy[type]?.[1] ?? 0,
  }));

  const providers: LlmProviderStatus[] = [
    {
      id: "codex-cli",
      available: true,
      reason: null,
      pausedUntil: null,
      concurrency: 2,
      inFlight: 2,
    },
    {
      id: "claude-code",
      available: false,
      reason: "provider_quota: the weekly limit is used up",
      pausedUntil: new Date(now + 2 * HOUR + 14 * 60_000).toISOString(),
      concurrency: 1,
      inFlight: 0,
    },
    {
      id: "gemini-cli",
      available: true,
      reason: null,
      pausedUntil: null,
      concurrency: 1,
      inFlight: 0,
    },
  ];

  const profile: ProfileSummary = {
    name: PERSON,
    headline: "Senior Full-Stack Engineer",
    factsMode: "strict",
    maxPages: 1,
    form: {
      location: "Valencia, Spain",
      timezone: "CET (UTC+1)",
      workFormat: "Remote",
      contract: "B2B contract or employment",
      relocation: false,
      needsSponsorship: false,
      salaryFrom: { amount: 6500, currency: "EUR", period: "month" },
      noticeWeeks: 2,
      eeo: "decline",
    },
    cases: [
      {
        id: "BE04",
        company: "Lattice Freight",
        title: "Rebuilt the order service as idempotent consumers",
        technologies: ["Node.js", "TypeScript", "RabbitMQ", "PostgreSQL"],
        active: true,
      },
      {
        id: "BE07",
        company: "Lattice Freight",
        title: "Cut the slowest report from 40 s to 1.2 s",
        technologies: ["PostgreSQL", "EXPLAIN", "Partitioning"],
        active: true,
      },
      {
        id: "BE09",
        company: "Copperleaf Payments",
        title: "Double-entry ledger for merchant payouts",
        technologies: ["Node.js", "PostgreSQL", "Outbox"],
        active: true,
      },
      {
        id: "BE11",
        company: "Copperleaf Payments",
        title: "Webhook delivery with retries and replay",
        technologies: ["NestJS", "Redis", "BullMQ"],
        active: true,
      },
      {
        id: "AR02",
        company: "Copperleaf Payments",
        title: "Event contracts shared by six services",
        technologies: ["Zod", "JSON Schema", "Kafka Connect"],
        active: true,
      },
      {
        id: "AR05",
        company: "Harbor & Vale",
        title: "Public API with versioning and SDKs",
        technologies: ["OpenAPI", "TypeScript"],
        active: true,
      },
      {
        id: "FE02",
        company: "Harbor & Vale",
        title: "Checkout rewritten in React with 18% fewer drop-offs",
        technologies: ["React", "TypeScript", "Vite"],
        active: true,
      },
      {
        id: "FE05",
        company: "Harbor & Vale",
        title: "Design system used by four product teams",
        technologies: ["React", "Radix", "Tailwind", "Storybook"],
        active: true,
      },
      {
        id: "FE08",
        company: "Copperleaf Payments",
        title: "Merchant dashboard on the Next.js App Router",
        technologies: ["Next.js", "React Server Components"],
        active: true,
      },
      {
        id: "UX03",
        company: "Harbor & Vale",
        title: "Accessibility audit fixed to WCAG 2.2 AA",
        technologies: ["axe", "Playwright"],
        active: true,
      },
      {
        id: "PF01",
        company: "Harbor & Vale",
        title: "Largest Contentful Paint from 3.9 s to 1.7 s",
        technologies: ["Web Vitals", "Lighthouse CI"],
        active: true,
      },
      {
        id: "QA02",
        company: "Lattice Freight",
        title: "End-to-end suite that runs in 6 minutes",
        technologies: ["Playwright", "Docker"],
        active: true,
      },
      {
        id: "SE03",
        company: "Lattice Freight",
        title: "Moved twelve services to Kubernetes",
        technologies: ["Kubernetes", "Helm", "Terraform"],
        active: true,
      },
      {
        id: "OW01",
        company: "Copperleaf Payments",
        title: "Led the on-call rotation and incident reviews",
        technologies: ["Grafana", "Prometheus"],
        active: true,
      },
      {
        id: "AI01",
        company: "Independent",
        title: "Agent that drafts support replies with tools",
        technologies: ["TypeScript", "Tool calling", "Evals"],
        active: true,
      },
      {
        id: "AI03",
        company: "Independent",
        title: "Offline evals that caught 3 regressions before release",
        technologies: ["Python", "pytest"],
        active: true,
      },
      {
        id: "BE02",
        company: "Northbeam Studio",
        title: "GraphQL gateway over three legacy APIs",
        technologies: ["GraphQL", "Apollo"],
        active: false,
      },
      {
        id: "CO02",
        company: "Northbeam Studio",
        title: "Mentored two junior engineers to mid level",
        technologies: [],
        active: false,
      },
    ],
  };

  const halcyon = byCompany("Halcyon Freight");
  return {
    now,
    random,
    applications,
    providers,
    jobs,
    queues,
    profile,
    unsortedMail: halcyon
      ? [
          {
            applicationId: halcyon,
            reason:
              "A reply from recruiting@halcyon.example did not match an application with certainty",
          },
        ]
      : [],
  };
}

export const mockTime = { HOUR, DAY };
