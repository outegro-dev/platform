import {
  type ApplicationFlag,
  type ApplicationStage,
  applicationStageSchema,
  archiveReasonSchema,
  type CvDocument,
  channelKindSchema,
  historySourceSchema,
  type Profile,
  type TaskUsage,
  type VacancyAnalysis,
  type VacancyFields,
  type VacancyStructure,
} from "@outegro/contracts/atelier";
import { platformTables } from "@outegro/db/schema";
import { sql } from "drizzle-orm";
import {
  bigserial,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const at = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/** A contract enum's values as the non-empty tuple Drizzle's text enums take. */
const valuesOf = <T extends string>(schema: { options: readonly T[] }) =>
  schema.options as unknown as [T, ...T[]];

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const { outbox, inbox } = platformTables;

/**
 * Owner of rows imported before the owner ever signed in (`--user owner`):
 * the first user with `atelier.use` and no profile adopts them.
 */
export const OWNER_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";

/** One profile per user: person, CV base, achievement bank, voice, form answers. */
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  data: jsonb("data").$type<Profile>().notNull(),
  /** Bumped on every import; a job keeps the version it started with. */
  version: integer("version").notNull().default(1),
  createdAt: at("created_at").notNull().defaultNow(),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export const vacancyStatuses = ["open", "closed"] as const;

/**
 * The shared catalog (no user): what a provider extracted, the structure
 * found by code, the analysis by the model (one call per vacancy, cached).
 * Copies of one posting meet on one of three keys (atelier-sources
 * `vacancyKeys`): the URL, a hash of the text, company + role + location.
 */
export const vacancies = pgTable(
  "vacancies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    urlKey: text("url_key").notNull(),
    textKey: text("text_key").notNull(),
    roleKey: text("role_key").notNull(),
    fields: jsonb("fields").$type<VacancyFields>().notNull(),
    structure: jsonb("structure").$type<VacancyStructure>().notNull(),
    analysis: jsonb("analysis").$type<VacancyAnalysis>(),
    /** Prompt version the analysis was made with; another one re-runs it. */
    analysisVersion: integer("analysis_version"),
    status: text("status", { enum: vacancyStatuses }).notNull().default("open"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vacancies_url_key_idx").on(t.urlKey),
    uniqueIndex("vacancies_text_key_idx").on(t.textKey),
    index("vacancies_role_key_idx").on(t.roleKey),
  ],
);

/** A card on the board: one per user and vacancy. */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    vacancyId: uuid("vacancy_id")
      .notNull()
      .references(() => vacancies.id),
    stage: text("stage", { enum: valuesOf(applicationStageSchema) })
      .$type<ApplicationStage>()
      .notNull(),
    archiveReason: text("archive_reason", {
      enum: valuesOf(archiveReasonSchema),
    }),
    flags: text("flags")
      .array()
      .$type<ApplicationFlag[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Quick score (structure) or the fit score (analysis), 0–100. */
    score: real("score"),
    channel: text("channel", { enum: valuesOf(channelKindSchema) }),
    sentAt: at("sent_at"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("applications_user_vacancy_idx").on(t.userId, t.vacancyId),
    index("applications_user_stage_idx").on(t.userId, t.stage),
  ],
);

/** One built CV; files under cv/{userId}/{applicationId}/{id}.pdf and .tex. */
export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    jobId: uuid("job_id"),
    storageKey: text("storage_key").notNull(),
    texKey: text("tex_key").notNull(),
    /** What the file is called when served: First_Last_Role_CV.pdf. */
    fileName: text("file_name").notNull(),
    pages: integer("pages").notNull(),
    atsCoverage: real("ats_coverage"),
    missingTerms: jsonb("missing_terms").$type<string[]>().notNull(),
    changes: jsonb("changes").$type<string[]>().notNull(),
    document: jsonb("document").$type<CvDocument>().notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("cv_versions_application_idx").on(t.applicationId)],
);

/** Public links: cv.outegro.dev/{hash}/{fileName}; a link stays on its version. */
export const cvLinks = pgTable(
  "cv_links",
  {
    hash: text("hash").primaryKey(),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id),
    opens: integer("opens").notNull().default(0),
    firstOpenedAt: at("first_opened_at"),
    revokedAt: at("revoked_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [index("cv_links_version_idx").on(t.cvVersionId)],
);

export const materialLocales = ["en", "ru"] as const;

/** Texts of an application: Telegram, email, cover letter…; versioned per kind. */
export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    kind: text("kind").notNull(),
    locale: text("locale", { enum: materialLocales }).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("materials_application_kind_idx").on(
      t.applicationId,
      t.kind,
      t.locale,
      t.version,
    ),
  ],
);

export const answerSources = ["bank", "model", "manual"] as const;

/** Answers given to the questions of an application form. */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    source: text("source", { enum: answerSources }).notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("answers_application_question_idx").on(
      t.applicationId,
      t.question,
    ),
  ],
);

export const contactStatuses = ["draft", "sent", "replied", "failed"] as const;

/** Every touch of an application: the form, an email, a Telegram message. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    kind: text("kind", { enum: valuesOf(channelKindSchema) }).notNull(),
    target: text("target").notNull(),
    status: text("status", { enum: contactStatuses }).notNull(),
    sentAt: at("sent_at"),
    note: text("note"),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [index("contacts_application_idx").on(t.applicationId)],
);

/** Append-only: what happened to an application and who did it. */
export const history = pgTable(
  "history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id),
    at: at("at").notNull(),
    action: text("action").notNull(),
    source: text("source", { enum: valuesOf(historySourceSchema) }).notNull(),
    details: text("details"),
  },
  (t) => [index("history_application_idx").on(t.applicationId, t.at)],
);

export const jobStatuses = [
  "queued",
  "running",
  "waiting_human",
  "done",
  "failed",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

/** Free state of a job: what it was started with and what it carries on. */
export type JobContext = {
  /** Input of the workflow (url, text, mode, kinds…). */
  input?: Record<string, unknown>;
  /** Started by a retry: outputs reused from this job. */
  retryOf?: string;
  /** Why the job stopped (failed or waiting for a human). */
  reason?: string;
  /** The profile version the job pinned when it started. */
  profileVersion?: number;
  /** Reserved CV version id (application.build). */
  cvVersionId?: string;
};

/** One run of a workflow (vacancy.ingest, application.build…) at its version. */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    userId: uuid("user_id"),
    vacancyId: uuid("vacancy_id"),
    applicationId: uuid("application_id"),
    status: text("status", { enum: jobStatuses }).notNull(),
    /** Index of the current step in the workflow's step list. */
    cursor: integer("cursor").notNull().default(0),
    context: jsonb("context").$type<JobContext>().notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    updatedAt: at("updated_at").notNull().defaultNow(),
    finishedAt: at("finished_at"),
  },
  (t) => [
    index("jobs_application_idx").on(t.applicationId, t.createdAt),
    index("jobs_status_idx").on(t.status, t.updatedAt),
  ],
);

export const stepStatuses = [
  "queued",
  "running",
  "paused",
  "done",
  "skipped",
  "failed",
  "waiting_human",
] as const;
export type StepStatus = (typeof stepStatuses)[number];

export type StepError = {
  code: string;
  message: string;
  retryable: boolean;
};

/** State of each step of a job; the pipeline screen reads it. */
export const jobSteps = pgTable(
  "job_steps",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    step: text("step").notNull(),
    /** Position in the workflow; steps of one job run in this order. */
    seq: integer("seq").notNull(),
    status: text("status", { enum: stepStatuses }).notNull(),
    attempt: integer("attempt").notNull().default(0),
    /** The task in flight; a result with another task id is stale. */
    taskId: uuid("task_id"),
    idempotencyKey: text("idempotency_key"),
    output: jsonb("output"),
    usage: jsonb("usage").$type<TaskUsage>(),
    error: jsonb("error").$type<StepError>(),
    /** Skipped or paused: why, shown on the pipeline screen. */
    note: text("note"),
    /** Paused (quota, backoff) until then; the task is already in the outbox. */
    dueAt: at("due_at"),
    deadline: at("deadline"),
    startedAt: at("started_at"),
    finishedAt: at("finished_at"),
  },
  (t) => [
    primaryKey({ columns: [t.jobId, t.step] }),
    uniqueIndex("job_steps_task_idx").on(t.taskId),
    index("job_steps_status_idx").on(t.status, t.step),
  ],
);

/** Files when STORAGE_DRIVER=pg (no object storage yet). */
export const files = pgTable("files", {
  key: text("key").primaryKey(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  createdAt: at("created_at").notNull().defaultNow(),
});
