import {
  type CvDocument,
  type Profile,
  profileSchema,
  type VacancyAnalysis,
  type VacancyFields,
} from "@outegro/contracts/atelier";

/*
 * Made-up data only: no real person, employer story or contact is in the
 * repository (the owner's profile is imported at runtime).
 */

const ratings = {
  FE: 3,
  BE: 5,
  AR: 4,
  RE: 3,
  PF: 2,
  QA: 2,
  SE: 1,
  OW: 3,
  EE: 3,
  CO: 1,
  UX: 0,
  AI: 0,
};

const bankCase = (id: string, companyId: string, title: string) => ({
  id,
  companyId,
  active: true,
  title,
  projectId: `${companyId}-${id.toLowerCase()}`,
  achievementGroupId: id,
  primaryTheme: "delivery",
  secondaryThemes: [],
  technologies: ["TypeScript", "Node.js", "PostgreSQL"],
  capabilities: [{ id: `${id}:api`, name: "api" }],
  categoryRatings: ratings,
  keyClaims: [
    { id: `${id}:core`, text: `Built the ${title.toLowerCase()} service.` },
  ],
  metricClaims: [{ id: `${id}:metric_1`, text: "40%" }],
  variants: {
    full: `Built the ${title.toLowerCase()} service in TypeScript and Node.js, cutting latency by 40% for every client.`,
    compact: `Built the ${title.toLowerCase()} service, cutting latency by 40%.`,
    minimal: `Cut ${title.toLowerCase()} latency by 40%.`,
  },
});

export const testProfile: Profile = profileSchema.parse({
  person: {
    name: "Alex Example",
    firstName: "Alex",
    lastName: "Example",
    location: "Example City, Exampleland",
    phoneDisplay: "+000 555 0100",
    phoneDigits: "+0005550100",
    email: "alex@example.com",
    links: [
      { url: "mailto:alex@example.com", text: "alex@example.com" },
      {
        url: "https://github.com/alex-example",
        text: "github.com/alex-example",
      },
    ],
    linkedin: null,
    github: "https://github.com/alex-example",
    website: null,
  },
  headline: "Senior Backend Engineer",
  stack: "TypeScript · Node.js · PostgreSQL",
  summary: {
    profile: {
      full: "Backend engineer with **6+ years** of experience.",
      compact: "Backend engineer.",
    },
    aiTools: {
      full: "Uses Codex and Claude Code with review.",
      compact: "Codex and Claude Code, reviewed.",
    },
  },
  skills: [{ label: "Backend", items: ["Node.js", "NestJS", "PostgreSQL"] }],
  companies: [
    {
      id: "acme",
      name: "Acme",
      title: "Software Engineer",
      dates: "Jan 2021 – Present",
      location: "Remote",
      description: "A made-up company",
      order: 0,
      quota: { general: { target: 2, min: 1 }, ai: { target: 2, min: 1 } },
      fixedBullets: [],
      aiOnly: false,
    },
  ],
  education: [
    {
      degree: "BSc Computer Science",
      school: "Example University",
      dates: "2015 – 2019",
    },
  ],
  languages: [{ name: "English", level: "C1" }],
  factsMode: "free",
  font: "plex",
  maxPages: 2,
  baseYears: 6,
  form: {
    location: "Example City",
    timezone: "GMT+0",
    workFormat: "Remote",
    contract: "B2B",
    relocation: false,
    needsSponsorship: false,
    salaryFrom: { amount: 1000, currency: "USD", period: "month" },
    noticeWeeks: 2,
    eeo: "decline",
  },
  voice: {
    rules: ["Short sentences."],
    telegramTemplateRu: null,
    aboutMe: null,
  },
  bank: {
    bankVersion: 1,
    cases: [
      bankCase("A1", "acme", "Billing"),
      bankCase("A2", "acme", "Search"),
    ],
  },
});

export const vacancyText = `Senior Backend Engineer at Examplecorp

We are looking for a Senior Backend Engineer to build our payments platform.
You have 5+ years of experience with Node.js and TypeScript, you know PostgreSQL
and you care about reliable APIs. Fully remote within Europe.`;

export function testFields(
  url = "https://jobs.lever.co/examplecorp/1234",
): VacancyFields {
  return {
    provider: "lever",
    url,
    originalUrl: null,
    applyUrl: `${url}/apply`,
    ats: "lever",
    atsBoard: "examplecorp",
    atsJobId: "1234",
    title: "Senior Backend Engineer",
    company: "Examplecorp",
    location: "Remote, Europe",
    remote: true,
    postedAt: null,
    salary: null,
    text: vacancyText,
  };
}

export const testAnalysis: VacancyAnalysis = {
  company: "Examplecorp",
  title: "Senior Backend Engineer",
  cvRole: { senior: true, focus: "Backend", noun: "Engineer" },
  aiCore: false,
  productQuestion: null,
  requirements: [
    {
      id: "R1",
      text: "5+ years with Node.js and TypeScript",
      importance: "must",
      categoryIds: ["BE"],
      technologyTags: ["Node.js", "TypeScript"],
      evidenceQuote: "5+ years of experience with Node.js and TypeScript",
    },
    {
      id: "R2",
      text: "PostgreSQL",
      importance: "preferred",
      categoryIds: ["BE"],
      technologyTags: ["PostgreSQL"],
      evidenceQuote: "you know PostgreSQL",
    },
  ],
};

export function testDocument(): CvDocument {
  return {
    name: "Alex Example",
    location: "Example City",
    phoneDisplay: "+000 555 0100",
    phoneDigits: "+0005550100",
    headline: "Senior Backend Engineer",
    stack: "TypeScript · Node.js",
    links: [
      {
        url: "https://github.com/alex-example",
        text: "github.com/alex-example",
      },
    ],
    summary: ["Backend engineer with **6+ years** of experience."],
    skills: [{ label: "Backend", items: ["Node.js", "PostgreSQL"] }],
    jobs: [
      {
        title: "Software Engineer",
        company: "Acme",
        dates: "Jan 2021 – Present",
        location: "Remote",
        description: "A made-up company",
        bullets: [{ id: "bullet:A1", text: "Built the billing service." }],
      },
    ],
    education: [],
    languages: [],
    pdf: {
      title: "Alex Example CV",
      subject: "Senior Backend Engineer",
      keywords: ["Node.js"],
    },
  };
}

/** A tiny but real PDF header, enough for the links to serve. */
export const fakePdf = Buffer.from("%PDF-1.7\n% made-up test file\n%%EOF\n");
