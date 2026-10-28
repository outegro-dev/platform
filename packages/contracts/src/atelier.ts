import { z } from "zod";
import { isoDateTime } from "./primitives.js";

/**
 * Atelier (atelier.outegro.dev): finds vacancies, builds a CV for each one
 * from the owner's achievement cases, writes the messages, applies and keeps
 * every application on a board. The pipeline is a chain of tasks; each task
 * type has its own queue `atelier.task.<type>` and the shapes below are the
 * wire formats shared by atelier-backend, its workers, llm-gateway,
 * atelier-tex and atelier-web. Rules (scoring, selection, fitting, checks)
 * live in `@outegro/atelier-engine`.
 */

export const atelierService = "atelier";

/* ---------- Board ---------- */

/** Columns of the board, left to right. */
export const applicationStages = [
  "found",
  "fit",
  "building",
  "ready",
  "sent",
  "hr",
  "task",
  "tech",
  "final",
  "offer",
  "archived",
] as const;
export const applicationStageSchema = z.enum(applicationStages);
export type ApplicationStage = z.infer<typeof applicationStageSchema>;

/** Why a card left the funnel; set only for `archived`. */
export const archiveReasonSchema = z.enum([
  "hired",
  "rejected",
  "ghosted",
  "withdrawn",
  "closed",
  "skipped",
]);
export type ArchiveReason = z.infer<typeof archiveReasonSchema>;

/** Marks on a card; the stage stays where it is. */
export const applicationFlagSchema = z.enum([
  "needs_edit",
  "needs_human",
  "follow_up",
  "meeting",
  "cv_opened",
  "dodep",
]);
export type ApplicationFlag = z.infer<typeof applicationFlagSchema>;

export const channelKindSchema = z.enum([
  "ats_form",
  "email",
  "telegram",
  "linkedin",
  "manual",
]);
export type ChannelKind = z.infer<typeof channelKindSchema>;

/** Who moved a card: the pipeline, a parsed email, or the owner. */
export const historySourceSchema = z.enum(["system", "mail", "manual"]);

/* ---------- Vacancy ---------- */

export const atsKindSchema = z.enum([
  "ashby",
  "lever",
  "greenhouse",
  "workable",
  "smartrecruiters",
  "workday",
  "teamtailor",
  "comeet",
  "personio",
  "other",
]);
export type AtsKind = z.infer<typeof atsKindSchema>;

export const salarySchema = z.object({
  min: z.number().nonnegative().nullable(),
  max: z.number().nonnegative().nullable(),
  currency: z.string().min(1).max(8),
  period: z.enum(["year", "month", "hour"]),
});
export type Salary = z.infer<typeof salarySchema>;

/** Level 1: what a provider extracted from one vacancy page. */
export const vacancyFieldsSchema = z.object({
  provider: z.string().min(1).max(60),
  url: z.url(),
  /** The ATS posting behind an aggregator link, when known. */
  originalUrl: z.url().nullable(),
  applyUrl: z.url().nullable(),
  ats: atsKindSchema.nullable(),
  /** ATS board / company slug, e.g. `acme` in jobs.lever.co/acme. */
  atsBoard: z.string().max(200).nullable(),
  atsJobId: z.string().max(200).nullable(),
  title: z.string().min(1).max(300),
  company: z.string().min(1).max(200),
  location: z.string().max(300).nullable(),
  remote: z.boolean().nullable(),
  postedAt: isoDateTime.nullable(),
  salary: salarySchema.nullable(),
  text: z.string().min(100).max(200_000),
});
export type VacancyFields = z.infer<typeof vacancyFieldsSchema>;

export const roleFocusSchema = z.enum([
  "frontend",
  "backend",
  "fullstack",
  "ai",
  "mobile",
  "other",
]);

/** Level 2: structure found by code, no model. */
export const vacancyStructureSchema = z.object({
  technologies: z.array(z.string().max(80)).max(200),
  seniority: z.enum(["junior", "middle", "senior", "lead", "unknown"]),
  yearsMin: z.number().int().min(0).max(30).nullable(),
  remote: z.boolean().nullable(),
  languages: z.array(z.string().max(40)).max(20),
  roleFocus: roleFocusSchema,
});
export type VacancyStructure = z.infer<typeof vacancyStructureSchema>;

/** The 12 achievement categories of the bank (FE … AI). */
export const categoryIds = [
  "FE",
  "BE",
  "AR",
  "RE",
  "PF",
  "QA",
  "SE",
  "OW",
  "EE",
  "CO",
  "UX",
  "AI",
] as const;
export const categoryIdSchema = z.enum(categoryIds);
export type CategoryId = z.infer<typeof categoryIdSchema>;

export const requirementSchema = z.object({
  id: z.string().regex(/^R\d{1,3}$/),
  text: z.string().min(1).max(1000),
  importance: z.enum(["must", "responsibility", "preferred"]),
  categoryIds: z.array(categoryIdSchema).min(1).max(3),
  technologyTags: z.array(z.string().max(80)).max(30),
  /** Copied verbatim from the vacancy text; checked by code. */
  evidenceQuote: z.string().min(1).max(1000),
});
export type Requirement = z.infer<typeof requirementSchema>;

export const cvRoleSchema = z.object({
  senior: z.boolean(),
  focus: z.enum(["Frontend", "Backend", "Full-Stack", "AI", "Software"]),
  noun: z.enum(["Engineer", "Developer"]),
});
export type CvRole = z.infer<typeof cvRoleSchema>;

/** Level 3: one model call per vacancy, shared by every user. */
export const vacancyAnalysisSchema = z.object({
  company: z.string().min(1).max(200),
  title: z.string().min(1).max(300),
  cvRole: cvRoleSchema.nullable(),
  aiCore: z.boolean(),
  /** A short question about the product for the Telegram template. */
  productQuestion: z.string().max(300).nullable(),
  requirements: z.array(requirementSchema).min(1).max(100),
});
export type VacancyAnalysis = z.infer<typeof vacancyAnalysisSchema>;

/* ---------- Profile and achievement bank ---------- */

/** Fonts of the "Minimal violet" CV template. */
export const cvFontSchema = z.enum(["plex", "manrope", "atkinson"]);

const nonEmpty = z.string().trim().min(1);
const claimSchema = z.object({ id: nonEmpty, text: nonEmpty });

export const categoryRatingsSchema = z.object(
  Object.fromEntries(
    categoryIds.map((id) => [id, z.number().int().min(0).max(5)]),
  ) as Record<CategoryId, z.ZodNumber>,
);

/**
 * One achievement case (bank v2 of Work Finder, generalised): the CV bullet
 * in three lengths plus what must survive any rewrite.
 */
export const bankCaseSchema = z.object({
  id: z.string().regex(/^[A-Z]{1,3}\d{1,3}$/),
  companyId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  active: z.boolean(),
  title: nonEmpty,
  projectId: nonEmpty,
  achievementGroupId: nonEmpty,
  primaryTheme: nonEmpty,
  secondaryThemes: z.array(nonEmpty),
  technologies: z.array(nonEmpty),
  /** The case competes only when a requirement names one of these words. */
  whenVacancyMentions: z.array(nonEmpty).min(1).optional(),
  capabilities: z
    .array(claimSchema.pick({ id: true }).extend({ name: nonEmpty }))
    .min(1),
  categoryRatings: categoryRatingsSchema,
  keyClaims: z.array(claimSchema).min(1),
  metricClaims: z.array(claimSchema),
  variants: z.object({
    full: nonEmpty.max(700),
    compact: nonEmpty.max(700),
    minimal: nonEmpty.max(700),
  }),
});
export type BankCase = z.infer<typeof bankCaseSchema>;

const quotaSchema = z.object({
  target: z.number().int().min(0).max(20),
  min: z.number().int().min(0).max(20),
});

export const profileCompanySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: nonEmpty.max(120),
  title: nonEmpty.max(120),
  dates: nonEmpty.max(60),
  location: z.string().max(60),
  description: z.string().max(200),
  /** Position on the CV, 0 first. */
  order: z.number().int().min(0),
  /** Bullets per template; a company with target 0 shows fixedBullets only. */
  quota: z.object({ general: quotaSchema, ai: quotaSchema }),
  /** Bullets that are always printed as they are (companies without cases). */
  fixedBullets: z.array(nonEmpty.max(700)).max(10),
  /** Leave the company out of the general template (an AI-only role). */
  aiOnly: z.boolean().default(false),
});
export type ProfileCompany = z.infer<typeof profileCompanySchema>;

export const formAnswersSchema = z.object({
  location: nonEmpty,
  timezone: nonEmpty,
  workFormat: nonEmpty,
  contract: nonEmpty,
  relocation: z.boolean(),
  needsSponsorship: z.boolean(),
  salaryFrom: z.object({
    amount: z.number().positive(),
    currency: z.string().min(1).max(8),
    period: z.enum(["year", "month"]),
  }),
  noticeWeeks: z.number().int().min(0).max(26),
  eeo: z.literal("decline"),
});
export type FormAnswers = z.infer<typeof formAnswersSchema>;

export const profileSchema = z.object({
  person: z.object({
    name: nonEmpty.max(120),
    firstName: nonEmpty.max(60),
    lastName: nonEmpty.max(60),
    location: nonEmpty.max(120),
    phoneDisplay: nonEmpty.max(40),
    phoneDigits: z.string().regex(/^\+?\d{6,20}$/),
    email: z.email(),
    links: z
      .array(z.object({ url: nonEmpty.max(300), text: nonEmpty.max(120) }))
      .max(8),
    linkedin: z.string().max(300).nullable(),
    github: z.string().max(300).nullable(),
    website: z.string().max(300).nullable(),
  }),
  headline: nonEmpty.max(120),
  stack: z.string().max(160),
  /** Base About of the master CV; adapted per vacancy. */
  summary: z.object({
    profile: z.object({ full: nonEmpty, compact: nonEmpty }),
    aiTools: z.object({ full: nonEmpty, compact: nonEmpty }),
  }),
  /** Base skill rows of the master CV, label and items. */
  skills: z
    .array(
      z.object({
        label: nonEmpty.max(60),
        items: z.array(nonEmpty.max(80)).min(1),
      }),
    )
    .min(1),
  companies: z.array(profileCompanySchema).min(1),
  education: z.array(
    z.object({ degree: nonEmpty, school: nonEmpty, dates: z.string() }),
  ),
  languages: z.array(z.object({ name: nonEmpty, level: nonEmpty })),
  /** free: may add vacancy technologies within a company's domain; strict: facts only. */
  factsMode: z.enum(["free", "strict"]),
  font: cvFontSchema,
  maxPages: z.union([z.literal(1), z.literal(2)]),
  /** Minimum years printed in the About; raised by the vacancy. */
  baseYears: z.number().int().min(0).max(40),
  form: formAnswersSchema,
  voice: z.object({
    rules: z.array(nonEmpty.max(500)).max(60),
    telegramTemplateRu: z.string().max(2000).nullable(),
    aboutMe: z.string().max(4000).nullable(),
  }),
  bank: z.object({
    bankVersion: z.number().int().positive(),
    cases: z.array(bankCaseSchema).min(1),
  }),
});
export type Profile = z.infer<typeof profileSchema>;

/* ---------- Tasks ---------- */

export const atelierTaskTypes = [
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
] as const;
export const atelierTaskTypeSchema = z.enum(atelierTaskTypes);
export type AtelierTaskType = z.infer<typeof atelierTaskTypeSchema>;

export const atelierTaskSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  type: atelierTaskTypeSchema,
  contract: z.number().int().positive(),
  attempt: z.number().int().min(1).max(10),
  idempotencyKey: z.string().min(1).max(300),
  userId: z.uuid().nullable(),
  input: z.unknown(),
  deadline: isoDateTime,
});
export type AtelierTask = z.infer<typeof atelierTaskSchema>;

export const taskUsageSchema = z.object({
  llmCalls: z.number().int().min(0),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  ms: z.number().int().min(0),
});
export type TaskUsage = z.infer<typeof taskUsageSchema>;

export const atelierTaskResultSchema = z.object({
  taskId: z.uuid(),
  jobId: z.uuid(),
  type: atelierTaskTypeSchema,
  status: z.enum(["ok", "retry", "fail", "needs_human"]),
  output: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1).max(80),
      message: z.string().max(2000),
      retryable: z.boolean(),
    })
    .optional(),
  usage: taskUsageSchema.optional(),
});
export type AtelierTaskResult = z.infer<typeof atelierTaskResultSchema>;

/* ---------- llm-gateway ---------- */

export const llmErrorCodeSchema = z.enum([
  "provider_quota",
  "provider_unavailable",
  "provider_timeout",
  "invalid_output",
  "bad_request",
]);
export type LlmErrorCode = z.infer<typeof llmErrorCodeSchema>;

export const llmGenerateRequestSchema = z.object({
  /** Profile id from the gateway config, e.g. `codex-sol-low`. */
  profile: z.string().min(1).max(80),
  /** What the call is for, e.g. `resume.compose`; logged, never the text. */
  purpose: z.string().min(1).max(80),
  system: z.string().min(1).max(50_000),
  input: z.string().min(1).max(600_000),
  /** JSON Schema of the answer (draft 2020-12, from z.toJSONSchema). */
  schema: z.record(z.string(), z.unknown()),
  requestId: z.string().min(1).max(200),
  timeoutMs: z.number().int().min(10_000).max(3_600_000).optional(),
  /** Which logged-in account to use; one account until SaaS. */
  account: z.string().max(80).optional(),
});
export type LlmGenerateRequest = z.infer<typeof llmGenerateRequestSchema>;

export const llmGenerateResponseSchema = z.object({
  output: z.unknown(),
  provider: z.string(),
  model: z.string(),
  usage: z.object({
    input: z.number().int().nullable(),
    output: z.number().int().nullable(),
  }),
  ms: z.number().int().min(0),
});
export type LlmGenerateResponse = z.infer<typeof llmGenerateResponseSchema>;

export const llmErrorSchema = z.object({
  error: llmErrorCodeSchema,
  retryable: z.boolean(),
  message: z.string().max(2000),
  resetsAt: isoDateTime.nullable(),
});
export type LlmError = z.infer<typeof llmErrorSchema>;

export const llmProviderStatusSchema = z.object({
  id: z.string(),
  available: z.boolean(),
  reason: z.string().nullable(),
  pausedUntil: isoDateTime.nullable(),
  concurrency: z.number().int().min(1),
  inFlight: z.number().int().min(0),
});
export type LlmProviderStatus = z.infer<typeof llmProviderStatusSchema>;

export const llmProfileSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).nullable(),
});
export type LlmProfile = z.infer<typeof llmProfileSchema>;

/* ---------- atelier-tex ---------- */

/**
 * The CV as data for the "Minimal violet" template. Bullet and summary text
 * may hold `**…**` spans, rendered highlighted; everything else is escaped.
 */
export const cvDocumentSchema = z.object({
  name: z.string().min(1).max(120),
  location: z.string().max(120),
  phoneDisplay: z.string().max(40),
  phoneDigits: z.string().regex(/^\+?\d{6,20}$/),
  headline: z.string().min(1).max(120),
  stack: z.string().max(160),
  links: z
    .array(
      z.object({
        url: z.string().min(1).max(300),
        text: z.string().min(1).max(120),
      }),
    )
    .max(8),
  summary: z.array(z.string().min(1).max(1200)).min(1).max(2),
  skills: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        items: z.array(z.string().min(1).max(80)).min(1).max(40),
      }),
    )
    .min(1)
    .max(14),
  jobs: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        company: z.string().min(1).max(120),
        dates: z.string().min(1).max(60),
        location: z.string().max(60),
        description: z.string().max(200),
        bullets: z
          .array(
            z.object({
              id: z.string().min(1).max(40),
              text: z.string().min(1).max(700),
            }),
          )
          .max(20),
      }),
    )
    .min(1)
    .max(10),
  education: z
    .array(
      z.object({
        degree: z.string().min(1).max(160),
        school: z.string().min(1).max(160),
        dates: z.string().max(60),
      }),
    )
    .max(4),
  languages: z
    .array(z.object({ name: z.string().max(40), level: z.string().max(80) }))
    .max(6),
  pdf: z.object({
    title: z.string().max(300),
    subject: z.string().max(500),
    keywords: z.array(z.string().max(80)).max(200),
  }),
});
export type CvDocument = z.infer<typeof cvDocumentSchema>;

export const texRenderRequestSchema = z.object({
  document: cvDocumentSchema,
  font: cvFontSchema.default("plex"),
});
export type TexRenderRequest = z.infer<typeof texRenderRequestSchema>;

/** One rendered CV with what the fitting loop needs to decide its next step. */
export const texRenderResponseSchema = z.object({
  pdfBase64: z.string(),
  texSource: z.string(),
  pages: z.number().int().min(0),
  /** Widest overfull \hbox in points; 0 when none. */
  overfullPt: z.number().min(0),
  fontsOk: z.boolean(),
  /** Lines each bullet / summary paragraph / skill row takes, by block id. */
  blocks: z.array(z.object({ id: z.string(), lines: z.number().int().min(0) })),
  /** Fill of the last page, 0–1. */
  lastPageFill: z.number().min(0).max(1),
  warnings: z.array(z.string()).max(200),
});
export type TexRenderResponse = z.infer<typeof texRenderResponseSchema>;

/* ---------- atelier-browser ---------- */

export const browserAtsSchema = z.enum([
  "ashby",
  "lever",
  "greenhouse",
  "workable",
]);

/**
 * Fill (prepare) or fill and submit one ATS application form. Answers come
 * from upstream (the answer bank and the texts step); the browser never
 * invents values, never solves a CAPTCHA and never logs in.
 */
export const browserApplyRequestSchema = z.object({
  mode: z.enum(["prepare", "submit"]),
  applyUrl: z.url(),
  ats: browserAtsSchema,
  fields: z.object({
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    fullName: z.string().min(1).max(120),
    email: z.email(),
    phone: z.string().max(40),
    location: z.string().max(120),
    linkedin: z.string().max(300).nullable(),
    github: z.string().max(300).nullable(),
    website: z.string().max(300).nullable(),
    currentCompany: z.string().max(120).nullable(),
    currentTitle: z.string().max(120).nullable(),
  }),
  answers: z
    .array(
      z.object({
        question: z.string().max(1000),
        answer: z.string().max(5000),
      }),
    )
    .max(80),
  cv: z.object({
    fileName: z.string().min(1).max(200),
    base64: z.string().min(1),
  }),
  coverLetter: z.string().max(10_000).nullable(),
  /** The profile's timezone ("GMT+4", "UTC-3" or an IANA name); UTC without it. */
  timezone: z.string().max(64).nullish(),
});
export type BrowserApplyRequest = z.infer<typeof browserApplyRequestSchema>;

export const browserApplyResponseSchema = z.object({
  status: z.enum(["submitted", "prepared", "needs_human", "failed"]),
  /** captcha, login_required, required_unanswered, validation_error, … */
  reason: z.string().max(500).nullable(),
  unanswered: z.array(
    z.object({
      label: z.string().max(1000),
      type: z.string().max(40),
      required: z.boolean(),
      options: z.array(z.string().max(300)).nullable(),
    }),
  ),
  filled: z.array(
    z.object({ label: z.string().max(1000), value: z.string().max(5000) }),
  ),
  screenshotBase64: z.string().nullable(),
  confirmation: z.string().max(2000).nullable(),
});
export type BrowserApplyResponse = z.infer<typeof browserApplyResponseSchema>;

/* ---------- atelier-web API (through atelier-backend) ---------- */

export const coverageLabelSchema = z.enum([
  "direct",
  "related",
  "weak",
  "missing",
]);

export const applicationCardSchema = z.object({
  id: z.uuid(),
  company: z.string(),
  role: z.string(),
  stage: applicationStageSchema,
  archiveReason: archiveReasonSchema.nullable(),
  flags: z.array(applicationFlagSchema),
  score: z.number().min(0).max(100).nullable(),
  channel: channelKindSchema.nullable(),
  source: z.string(),
  location: z.string().nullable(),
  sentAt: isoDateTime.nullable(),
  updatedAt: isoDateTime,
});
export type ApplicationCard = z.infer<typeof applicationCardSchema>;

export const boardSchema = z.object({
  columns: z.array(
    z.object({
      stage: applicationStageSchema,
      items: z.array(applicationCardSchema),
    }),
  ),
  stats: z.object({
    total: z.number().int(),
    sent: z.number().int(),
    sentToday: z.number().int(),
    replies: z.number().int(),
    interviews: z.number().int(),
    offers: z.number().int(),
  }),
});
export type Board = z.infer<typeof boardSchema>;

export const pipelineStepViewSchema = z.object({
  step: atelierTaskTypeSchema,
  status: z.enum([
    "waiting",
    "running",
    "ok",
    "failed",
    "skipped",
    "needs_human",
  ]),
  ms: z.number().int().nullable(),
  llmCalls: z.number().int(),
  note: z.string().nullable(),
});

export const applicationDetailSchema = z.object({
  card: applicationCardSchema,
  vacancy: z.object({
    title: z.string(),
    company: z.string(),
    location: z.string().nullable(),
    url: z.string(),
    applyUrl: z.string().nullable(),
    salary: salarySchema.nullable(),
    text: z.string(),
  }),
  fit: z
    .object({
      score: z.number(),
      requirements: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          importance: z.enum(["must", "responsibility", "preferred"]),
          label: coverageLabelSchema,
          caseIds: z.array(z.string()),
        }),
      ),
    })
    .nullable(),
  cv: z
    .object({
      versionId: z.uuid(),
      fileName: z.string(),
      pdfUrl: z.string(),
      shareUrl: z.string().nullable(),
      opens: z.number().int(),
      pages: z.number().int(),
      atsCoverage: z.number().min(0).max(1).nullable(),
      changes: z.array(z.string()),
    })
    .nullable(),
  materials: z.array(
    z.object({
      kind: z.string(),
      locale: z.enum(["en", "ru"]),
      subject: z.string().nullable(),
      body: z.string(),
    }),
  ),
  answers: z.array(z.object({ question: z.string(), answer: z.string() })),
  contacts: z.array(
    z.object({
      kind: channelKindSchema,
      target: z.string(),
      status: z.enum(["draft", "sent", "replied", "failed"]),
      sentAt: isoDateTime.nullable(),
      note: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      at: isoDateTime,
      action: z.string(),
      source: historySourceSchema,
      details: z.string().nullable(),
    }),
  ),
  pipeline: z.array(pipelineStepViewSchema),
});
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

export const inboxSchema = z.object({
  matches: z.array(applicationCardSchema),
  tasks: z.array(
    z.object({
      applicationId: z.uuid(),
      company: z.string(),
      role: z.string(),
      kind: z.enum(["needs_human", "needs_edit", "unsorted_mail"]),
      reason: z.string(),
      url: z.string().nullable(),
    }),
  ),
});
export type Inbox = z.infer<typeof inboxSchema>;

export const pipelineOverviewSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      applicationId: z.uuid().nullable(),
      title: z.string(),
      step: atelierTaskTypeSchema.nullable(),
      status: z.enum(["queued", "running", "waiting_human", "done", "failed"]),
      startedAt: isoDateTime,
      updatedAt: isoDateTime,
    }),
  ),
  queues: z.array(
    z.object({
      type: atelierTaskTypeSchema,
      waiting: z.number().int(),
      running: z.number().int(),
    }),
  ),
  providers: z.array(llmProviderStatusSchema),
});
export type PipelineOverview = z.infer<typeof pipelineOverviewSchema>;

export const addVacancyRequestSchema = z
  .object({
    url: z.url().optional(),
    text: z.string().min(100).max(200_000).optional(),
  })
  .refine((v) => v.url !== undefined || v.text !== undefined, {
    message: "url or text is required",
  });
export type AddVacancyRequest = z.infer<typeof addVacancyRequestSchema>;

export const moveStageRequestSchema = z.object({
  stage: applicationStageSchema,
  archiveReason: archiveReasonSchema.optional(),
});
export type MoveStageRequest = z.infer<typeof moveStageRequestSchema>;
