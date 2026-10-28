import {
  type ApplicationCard,
  type ApplicationStage,
  addVacancyRequestSchema,
  applicationStages,
  type Board,
  type Inbox,
  moveStageRequestSchema,
  type PipelineOverview,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import {
  createMockState,
  type MockApplication,
  type MockState,
  mockUuid,
} from "./mock-data";
import { retryRequestSchema } from "./schemas";

/*
 * A fake atelier-backend for mock mode: the same paths, bodies and status
 * codes as the real one, over made-up data held in memory for as long as
 * the server runs. The BFF calls it instead of the network and validates
 * its answers with the same schemas, so the interface cannot tell the
 * difference. State lives on globalThis: route handlers and pages may be
 * bundled apart, but they share one process.
 */

export type MockResponse = { status: number; body?: unknown };

const KEY = Symbol.for("atelier-web.mock-state");
type WithState = typeof globalThis & { [KEY]?: MockState };

export function mockState(): MockState {
  const holder = globalThis as WithState;
  holder[KEY] ??= createMockState();
  return holder[KEY];
}

/** Starts the mock over (tests). */
export function resetMock(now?: number): MockState {
  const holder = globalThis as WithState;
  holder[KEY] = createMockState(now);
  return holder[KEY];
}

const error = (status: number, code: string, message = code) => ({
  status,
  body: {
    error: {
      code,
      messageKey: `errors.${code.toLowerCase()}`,
      fieldErrors: {},
      requestId: "mock",
      retryable: false,
      message,
    },
  },
});

const isoNow = () => new Date().toISOString();

const passed = new Set<ApplicationStage>([
  "sent",
  "hr",
  "task",
  "tech",
  "final",
  "offer",
]);

/** The board stats the backend counts. */
function statsOf(cards: ApplicationCard[]): Board["stats"] {
  const today = new Date().toISOString().slice(0, 10);
  const replied = new Set<ApplicationStage>([
    "hr",
    "task",
    "tech",
    "final",
    "offer",
  ]);
  return {
    total: cards.length,
    sent: cards.filter((c) => c.sentAt !== null).length,
    sentToday: cards.filter((c) => c.sentAt?.slice(0, 10) === today).length,
    replies: cards.filter(
      (c) =>
        replied.has(c.stage) ||
        (c.stage === "archived" &&
          c.archiveReason === "rejected" &&
          c.sentAt !== null),
    ).length,
    interviews: cards.filter((c) =>
      (["hr", "task", "tech", "final"] as ApplicationStage[]).includes(c.stage),
    ).length,
    offers: cards.filter(
      (c) =>
        c.stage === "offer" ||
        (c.stage === "archived" && c.archiveReason === "hired"),
    ).length,
  };
}

function board(state: MockState): Board {
  const cards = state.applications.map((a) => a.card);
  return {
    columns: applicationStages.map((stage) => ({
      stage,
      items: cards
        .filter((c) => c.stage === stage)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    })),
    stats: statsOf(cards),
  };
}

function inbox(state: MockState): Inbox {
  const matches = state.applications
    .map((a) => a.card)
    .filter((c) => c.stage === "fit")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const tasks: Inbox["tasks"] = [];
  for (const { card, detail } of state.applications) {
    if (card.flags.includes("needs_human"))
      tasks.push({
        applicationId: card.id,
        company: card.company,
        role: card.role,
        kind: "needs_human",
        reason:
          detail.pipeline.find((s) => s.status === "needs_human")?.note ??
          "The form needs a person",
        url: detail.vacancy.applyUrl ?? detail.vacancy.url,
      });
    if (card.flags.includes("needs_edit"))
      tasks.push({
        applicationId: card.id,
        company: card.company,
        role: card.role,
        kind: "needs_edit",
        reason:
          detail.pipeline.find((s) => s.status === "failed")?.note ??
          "The CV did not build",
        url: null,
      });
  }
  for (const mail of state.unsortedMail) {
    const app = state.applications.find(
      (a) => a.card.id === mail.applicationId,
    );
    if (app)
      tasks.push({
        applicationId: app.card.id,
        company: app.card.company,
        role: app.card.role,
        kind: "unsorted_mail",
        reason: mail.reason,
        url: null,
      });
  }
  return { matches, tasks };
}

function pipeline(state: MockState): PipelineOverview {
  return {
    jobs: [...state.jobs].sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    ),
    queues: state.queues,
    providers: state.providers,
  };
}

function touch(app: MockApplication, action: string, details: string | null) {
  const at = isoNow();
  app.card.updatedAt = at;
  app.detail.history.unshift({ at, action, source: "manual", details });
}

function move(
  app: MockApplication,
  stage: ApplicationStage,
  reason?: z.infer<typeof moveStageRequestSchema>["archiveReason"],
) {
  app.card.stage = stage;
  app.card.archiveReason =
    stage === "archived" ? (reason ?? "withdrawn") : null;
  if (passed.has(stage) && app.card.sentAt === null) app.card.sentAt = isoNow();
  touch(
    app,
    stage === "archived" ? "archived" : "moved",
    stage === "archived" ? (reason ?? null) : `To ${stage}`,
  );
}

/** Restarts the build from `fromStep` (the first failed step by default). */
function restart(
  state: MockState,
  app: MockApplication,
  fromStep?: string,
): string {
  const steps = app.detail.pipeline;
  let from = fromStep ? steps.findIndex((s) => s.step === fromStep) : -1;
  if (from < 0)
    from = steps.findIndex(
      (s) => s.status === "failed" || s.status === "needs_human",
    );
  if (from < 0) from = steps.findIndex((s) => s.status !== "ok");
  if (from < 0) from = 0;
  steps.forEach((step, i) => {
    if (i < from) return;
    step.status = i === from ? "running" : "waiting";
    step.ms = null;
    step.llmCalls = 0;
    step.note = null;
  });
  app.card.flags = app.card.flags.filter(
    (f) => f !== "needs_edit" && f !== "needs_human",
  );
  if (!passed.has(app.card.stage) && app.card.stage !== "archived")
    app.card.stage = "building";
  const jobId = mockUuid(state.random);
  const now = isoNow();
  state.jobs.unshift({
    id: jobId,
    kind: "application.build",
    applicationId: app.card.id,
    title: `${app.card.company}, ${app.card.role}`,
    step: steps[from]?.step ?? null,
    status: "running",
    startedAt: now,
    updatedAt: now,
  });
  touch(app, "retried", `From ${steps[from]?.step ?? "the start"}`);
  return jobId;
}

function send(state: MockState, app: MockApplication): string {
  const now = isoNow();
  app.card.stage = "sent";
  app.card.sentAt = now;
  app.card.flags = app.card.flags.filter((f) => f !== "needs_human");
  for (const step of app.detail.pipeline)
    if (step.step === "send") {
      step.status = "ok";
      step.ms = 12_400;
      step.note = null;
    }
  const kind = app.card.channel ?? "manual";
  app.detail.contacts.unshift({
    kind,
    target: app.detail.vacancy.applyUrl ?? app.detail.vacancy.url,
    status: "sent",
    sentAt: now,
    note: "The main application",
  });
  if (app.detail.cv && !app.detail.cv.shareUrl)
    app.detail.cv.shareUrl = `https://cv.outegro.dev/${app.detail.cv.versionId.slice(0, 12)}/${app.detail.cv.fileName}`;
  const jobId = mockUuid(state.random);
  state.jobs.unshift({
    id: jobId,
    kind: "application.send",
    applicationId: app.card.id,
    title: `${app.card.company}, ${app.card.role}`,
    step: "send",
    status: "done",
    startedAt: now,
    updatedAt: now,
  });
  touch(app, "sent", `Through ${kind}`);
  return jobId;
}

/** A vacancy added by hand: a new card in "found", its build queued. */
function add(state: MockState, request: { url?: string; text?: string }) {
  const id = mockUuid(state.random);
  const now = isoNow();
  const host = request.url ? new URL(request.url).hostname : null;
  const title =
    request.text
      ?.split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 80) ?? "New vacancy";
  const company = host?.replace(/^(www|jobs|careers|boards)\./, "") ?? "Pasted";
  const template = state.applications[0];
  if (!template) throw new Error("the mock has no applications");
  const app: MockApplication = structuredClone(template);
  app.card = {
    id,
    company,
    role: request.url ? "Reading the posting…" : title,
    stage: "found",
    archiveReason: null,
    flags: [],
    score: null,
    channel: null,
    source: "manual",
    location: null,
    sentAt: null,
    updatedAt: now,
  };
  app.detail.vacancy = {
    title: app.card.role,
    company,
    location: null,
    url: request.url ?? `https://atelier.outegro.dev/pasted/${id}`,
    applyUrl: null,
    salary: null,
    text: request.text ?? "",
  };
  app.detail.fit = null;
  app.detail.cv = null;
  app.detail.materials = [];
  app.detail.answers = [];
  app.detail.contacts = [];
  app.detail.history = [
    { at: now, action: "added", source: "manual", details: host },
  ];
  app.detail.pipeline = app.detail.pipeline.map((step, i) => ({
    ...step,
    status: i === 0 ? "running" : "waiting",
    ms: null,
    llmCalls: 0,
    note: null,
  }));
  state.applications.unshift(app);
  state.jobs.unshift({
    id: mockUuid(state.random),
    kind: "vacancy.add",
    applicationId: id,
    title: `${company}: ${app.card.role}`,
    step: "fetch",
    status: "running",
    startedAt: now,
    updatedAt: now,
  });
  return id;
}

const parse = <T>(schema: z.ZodType<T>, body: unknown) => {
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
};

/** Answers one call the way atelier-backend would. */
export function mockBackend(
  method: string,
  path: string,
  body?: unknown,
): MockResponse {
  const state = mockState();
  const parts = path.split("?")[0]?.split("/").filter(Boolean) ?? [];
  const find = (id: string | undefined) =>
    state.applications.find((a) => a.card.id === id);

  if (method === "GET" && path === "/board")
    return { status: 200, body: board(state) };
  if (method === "GET" && path === "/inbox")
    return { status: 200, body: inbox(state) };
  if (method === "GET" && path === "/pipeline")
    return { status: 200, body: pipeline(state) };
  if (method === "GET" && path === "/profile")
    return { status: 200, body: state.profile };

  if (method === "POST" && path === "/vacancies") {
    const request = parse(addVacancyRequestSchema, body);
    if (!request) return error(422, "VALIDATION_FAILED");
    return {
      status: 201,
      body: { jobId: crypto.randomUUID(), applicationId: add(state, request) },
    };
  }

  if (parts[0] === "applications" && parts[1]) {
    const app = find(parts[1]);
    if (!app) return error(404, "NOT_FOUND");
    if (method === "GET" && parts.length === 2)
      return { status: 200, body: { card: app.card, ...app.detail } };
    if (method === "POST" && parts[2] === "stage") {
      const request = parse(moveStageRequestSchema, body);
      if (!request) return error(422, "VALIDATION_FAILED");
      move(app, request.stage, request.archiveReason);
      return { status: 200, body: app.card };
    }
    if (method === "POST" && parts[2] === "send") {
      if (app.card.stage !== "ready") return error(409, "NOT_READY");
      return { status: 202, body: { jobId: send(state, app) } };
    }
    if (method === "POST" && parts[2] === "retry") {
      const request = parse(retryRequestSchema, body ?? {});
      if (!request) return error(422, "VALIDATION_FAILED");
      return {
        status: 202,
        body: { jobId: restart(state, app, request.fromStep) },
      };
    }
  }

  if (method === "POST" && parts[0] === "inbox" && parts[2] === "skip") {
    const app = find(parts[1]);
    if (!app) return error(404, "NOT_FOUND");
    move(app, "archived", "skipped");
    return { status: 200, body: app.card };
  }

  if (method === "DELETE" && parts[0] === "providers" && parts[2] === "pause") {
    const provider = state.providers.find((p) => p.id === parts[1]);
    if (!provider) return error(404, "NOT_FOUND");
    provider.pausedUntil = null;
    provider.available = true;
    provider.reason = null;
    return { status: 200, body: provider };
  }

  return error(404, "NOT_FOUND");
}

/** The id of a CV version in mock mode, from /api/atelier/mock/cv/:id. */
export const mockCvIdSchema = z.uuid();

/** The application a CV version belongs to (mock mode). */
export function mockCvOwner(versionId: string): MockApplication | null {
  return (
    mockState().applications.find(
      (a) => a.detail.cv?.versionId === versionId,
    ) ?? null
  );
}
