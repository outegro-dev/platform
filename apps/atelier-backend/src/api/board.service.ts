import { Inject, Injectable } from "@nestjs/common";
import {
  type AddVacancyRequest,
  type ApplicationDetail,
  applicationDetailSchema,
  type Board,
  type Inbox,
  llmProviderStatusSchema,
  type MoveStageRequest,
  type PipelineOverview,
} from "@outegro/contracts/atelier";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getJson } from "../clients/http.js";
import type { AtelierDatabase } from "../common/database.js";
import {
  type CvLinksConfig,
  cvLinksConfig,
  type ServicesConfig,
  servicesConfig,
} from "../config/config.js";
import {
  answers,
  applications,
  contacts,
  cvLinks,
  cvVersions,
  history,
  jobSteps,
  jobs,
  materials,
  vacancies,
} from "../db/schema.js";
import { TaskBus } from "../messaging/task-bus.js";
import { remoteTaskTypes } from "../messaging/task-types.js";
import { addHistory, setStage } from "../orchestrator/board-ops.js";
import { OrchestratorService } from "../orchestrator/orchestrator.service.js";
import { selectOutputSchema } from "../orchestrator/outputs.js";
import { STORAGE, type Storage } from "../storage/storage.js";
import {
  type CardRow,
  toBoard,
  toCard,
  toFit,
  toStepViews,
} from "./mappers.js";

const cardColumns = {
  id: applications.id,
  stage: applications.stage,
  archiveReason: applications.archiveReason,
  flags: applications.flags,
  score: applications.score,
  channel: applications.channel,
  sentAt: applications.sentAt,
  updatedAt: applications.updatedAt,
  fields: vacancies.fields,
  analysis: vacancies.analysis,
};

/** The board, a card's detail, the inbox and the pipeline screen. */
@Injectable()
export class BoardService {
  constructor(
    @Inject(DATABASE) private readonly database: AtelierDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(cvLinksConfig.KEY) private readonly links: CvLinksConfig,
    @Inject(servicesConfig.KEY) private readonly services: ServicesConfig,
    @Inject(STORAGE) private readonly storage: Storage,
    private readonly orchestrator: OrchestratorService,
    private readonly bus: TaskBus,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async cards(userId: string, extra?: ReturnType<typeof and>) {
    return (await this.db
      .select(cardColumns)
      .from(applications)
      .innerJoin(vacancies, eq(vacancies.id, applications.vacancyId))
      .where(
        extra
          ? and(eq(applications.userId, userId), extra)
          : eq(applications.userId, userId),
      )
      .orderBy(desc(applications.updatedAt))) as CardRow[];
  }

  async board(userId: string): Promise<Board> {
    return toBoard(await this.cards(userId), this.clock.now());
  }

  /** The card of this user, or 404 (another user's card does not exist for them). */
  async own(userId: string, applicationId: string) {
    const [row] = await this.db
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, applicationId),
          eq(applications.userId, userId),
        ),
      );
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  }

  private async lastJob(applicationId: string, kind: string) {
    const [job] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.applicationId, applicationId), eq(jobs.kind, kind)))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    if (!job) return null;
    const steps = await this.db
      .select()
      .from(jobSteps)
      .where(eq(jobSteps.jobId, job.id))
      .orderBy(asc(jobSteps.seq));
    return { job, steps };
  }

  async detail(
    userId: string,
    applicationId: string,
  ): Promise<ApplicationDetail> {
    await this.own(userId, applicationId);
    const [row] = (await this.cards(
      userId,
      eq(applications.id, applicationId),
    )) as CardRow[];
    if (!row) throw new AppError("NOT_FOUND");
    const [build, send] = await Promise.all([
      this.lastJob(applicationId, "application.build"),
      this.lastJob(applicationId, "application.send"),
    ]);
    const selectStep = build?.steps.find((step) => step.step === "select");
    const selection = selectStep?.output
      ? (selectOutputSchema.safeParse(selectStep.output).data?.selection ??
        null)
      : null;
    const [cv] = await this.db
      .select()
      .from(cvVersions)
      .where(eq(cvVersions.applicationId, applicationId))
      .orderBy(desc(cvVersions.createdAt))
      .limit(1);
    const [link] = cv
      ? await this.db
          .select()
          .from(cvLinks)
          .where(and(eq(cvLinks.cvVersionId, cv.id), isNull(cvLinks.revokedAt)))
          .orderBy(desc(cvLinks.createdAt))
          .limit(1)
      : [];
    const texts = await this.db
      .select()
      .from(materials)
      .where(eq(materials.applicationId, applicationId))
      .orderBy(asc(materials.kind), desc(materials.version));
    const latest = new Map<string, (typeof texts)[number]>();
    for (const text of texts) {
      const key = `${text.kind}:${text.locale}`;
      if (!latest.has(key)) latest.set(key, text);
    }
    const given = await this.db
      .select()
      .from(answers)
      .where(eq(answers.applicationId, applicationId))
      .orderBy(asc(answers.createdAt));
    const touches = await this.db
      .select()
      .from(contacts)
      .where(eq(contacts.applicationId, applicationId))
      .orderBy(asc(contacts.createdAt));
    const events = await this.db
      .select()
      .from(history)
      .where(eq(history.applicationId, applicationId))
      .orderBy(asc(history.at), asc(history.id));
    return applicationDetailSchema.parse({
      card: toCard(row),
      vacancy: {
        title: row.analysis?.title ?? row.fields.title,
        company: row.analysis?.company ?? row.fields.company,
        location: row.fields.location,
        url: row.fields.url,
        applyUrl: row.fields.applyUrl,
        salary: row.fields.salary,
        text: row.fields.text,
      },
      fit: toFit(row.analysis, selection, row.score),
      cv: cv
        ? {
            versionId: cv.id,
            fileName: cv.fileName,
            pdfUrl: `/v1/applications/${applicationId}/cv.pdf`,
            shareUrl: link
              ? `${this.links.publicBaseUrl}/${link.hash}/${cv.fileName}`
              : null,
            opens: link?.opens ?? 0,
            pages: cv.pages,
            atsCoverage: cv.atsCoverage,
            changes: cv.changes,
          }
        : null,
      materials: [...latest.values()].map((text) => ({
        kind: text.kind,
        locale: text.locale,
        subject: text.subject,
        body: text.body,
      })),
      answers: given.map((item) => ({
        question: item.question,
        answer: item.answer,
      })),
      contacts: touches.map((item) => ({
        kind: item.kind,
        target: item.target,
        status: item.status,
        sentAt: item.sentAt?.toISOString() ?? null,
        note: item.note,
      })),
      history: events.map((item) => ({
        at: item.at.toISOString(),
        action: item.action,
        source: item.source,
        details: item.details,
      })),
      pipeline: [
        ...toStepViews(build?.steps ?? []),
        ...toStepViews(send?.steps ?? []),
      ],
    });
  }

  /** The newest CV file of a card for the owner's download. */
  async cvFile(userId: string, applicationId: string) {
    await this.own(userId, applicationId);
    const [cv] = await this.db
      .select()
      .from(cvVersions)
      .where(eq(cvVersions.applicationId, applicationId))
      .orderBy(desc(cvVersions.createdAt))
      .limit(1);
    if (!cv) throw new AppError("NOT_FOUND");
    const file = await this.storage.get(cv.storageKey);
    if (!file)
      throw new AppError("NOT_FOUND", { message: "the CV file is gone" });
    return { fileName: cv.fileName, body: file.body };
  }

  async addVacancy(userId: string, body: AddVacancyRequest) {
    const jobId = await this.orchestrator.start({
      kind: "vacancy.ingest",
      userId,
      input: {
        ...(body.url ? { url: body.url } : {}),
        ...(body.text ? { text: body.text } : {}),
        manualBase: `${this.links.publicBaseUrl.replace(/\/cv$/, "")}/manual`,
        followUp: { userId },
      },
    });
    return { jobId };
  }

  async moveStage(
    userId: string,
    applicationId: string,
    body: MoveStageRequest,
  ) {
    const application = await this.own(userId, applicationId);
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await setStage(
        tx,
        applicationId,
        body.stage,
        now,
        body.archiveReason ?? null,
      );
      if (body.stage === "sent" && !application.sentAt)
        await tx
          .update(applications)
          .set({ sentAt: now })
          .where(eq(applications.id, applicationId));
      await addHistory(tx, applicationId, {
        at: now,
        action:
          body.stage === "archived"
            ? `moved to archived (${body.archiveReason ?? "withdrawn"})`
            : `moved to ${body.stage}`,
        source: "manual",
        details: `from ${application.stage}`,
      });
    });
    return this.detail(userId, applicationId).then((detail) => detail.card);
  }

  async send(
    userId: string,
    applicationId: string,
    mode: "prepare" | "submit",
  ) {
    await this.own(userId, applicationId);
    const [cv] = await this.db
      .select({ id: cvVersions.id })
      .from(cvVersions)
      .where(eq(cvVersions.applicationId, applicationId))
      .limit(1);
    if (!cv)
      throw new AppError("CONFLICT", { message: "the card has no CV yet" });
    const [running] = await this.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.applicationId, applicationId),
          eq(jobs.kind, "application.send"),
          inArray(jobs.status, ["queued", "running"]),
        ),
      )
      .limit(1);
    if (running) return { jobId: running.id };
    const [application] = await this.db
      .select({ vacancyId: applications.vacancyId })
      .from(applications)
      .where(eq(applications.id, applicationId));
    const jobId = await this.orchestrator.start({
      kind: "application.send",
      userId,
      vacancyId: application?.vacancyId ?? null,
      applicationId,
      input: { mode },
    });
    return { jobId };
  }

  async retry(userId: string, applicationId: string, fromStep?: string) {
    await this.own(userId, applicationId);
    const jobId = await this.orchestrator.retry(applicationId, fromStep);
    if (!jobId)
      throw new AppError("NOT_FOUND", { message: "nothing to retry" });
    return { jobId };
  }

  async inbox(userId: string): Promise<Inbox> {
    const matches = (
      await this.cards(userId, inArray(applications.stage, ["found", "fit"]))
    )
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
      .slice(0, 100)
      .map(toCard);
    const flagged = await this.cards(
      userId,
      sql`(${applications.flags} && array['needs_human','needs_edit']::text[]) and ${applications.stage} <> 'archived'`,
    );
    const tasks: Inbox["tasks"] = [];
    for (const row of flagged) {
      const [job] = await this.db
        .select({ context: jobs.context })
        .from(jobs)
        .where(
          and(
            eq(jobs.applicationId, row.id),
            inArray(jobs.status, ["failed", "waiting_human"]),
          ),
        )
        .orderBy(desc(jobs.updatedAt))
        .limit(1);
      const card = toCard(row);
      for (const kind of ["needs_human", "needs_edit"] as const)
        if (row.flags.includes(kind))
          tasks.push({
            applicationId: row.id,
            company: card.company,
            role: card.role,
            kind,
            reason: (job?.context.reason ?? kind.replace("_", " ")).slice(
              0,
              1000,
            ),
            url: row.fields.applyUrl ?? row.fields.url,
          });
    }
    return { matches, tasks };
  }

  async skip(userId: string, applicationId: string) {
    await this.own(userId, applicationId);
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      await setStage(tx, applicationId, "archived", now, "skipped");
      await addHistory(tx, applicationId, {
        at: now,
        action: "skipped",
        source: "manual",
      });
    });
    return this.detail(userId, applicationId).then((detail) => detail.card);
  }

  async pipeline(userId: string): Promise<PipelineOverview> {
    const recent = await this.db
      .select({
        id: jobs.id,
        kind: jobs.kind,
        applicationId: jobs.applicationId,
        status: jobs.status,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        context: jobs.context,
        fields: vacancies.fields,
        analysis: vacancies.analysis,
      })
      .from(jobs)
      .leftJoin(vacancies, eq(vacancies.id, jobs.vacancyId))
      .where(sql`(${jobs.userId} = ${userId} or ${jobs.userId} is null)`)
      .orderBy(
        sql`case when ${jobs.status} in ('queued','running','waiting_human') then 0 else 1 end`,
        desc(jobs.updatedAt),
      )
      .limit(60);
    const ids = recent.map((job) => job.id);
    const current = ids.length
      ? await this.db
          .select({
            jobId: jobSteps.jobId,
            step: jobSteps.step,
            seq: jobSteps.seq,
            status: jobSteps.status,
          })
          .from(jobSteps)
          .where(
            and(
              inArray(jobSteps.jobId, ids),
              inArray(jobSteps.status, [
                "running",
                "paused",
                "failed",
                "waiting_human",
              ]),
            ),
          )
      : [];
    const stepOf = new Map<string, string>();
    for (const step of current.sort((a, b) => a.seq - b.seq))
      if (!stepOf.has(step.jobId)) stepOf.set(step.jobId, step.step);
    const running = await this.orchestrator.activeSteps();
    const runningOf = new Map(running.map((row) => [row.step, row.count]));
    const queues = await Promise.all(
      remoteTaskTypes.map(async (type) => ({
        type,
        waiting: await this.bus.depth(type),
        running: runningOf.get(type) ?? 0,
      })),
    );
    const providers = z
      .array(llmProviderStatusSchema)
      .safeParse(
        await getJson(
          `${this.services.llm.url}/v1/providers`,
          this.services.llm.token,
        ),
      );
    return {
      jobs: recent.map((job) => {
        const step = stepOf.get(job.id);
        const parsedStep =
          remoteTaskTypes.find((type) => type === step) ??
          (step === "dedupe" ? "dedupe" : null);
        const title = job.fields
          ? `${job.analysis?.title ?? job.fields.title} · ${job.analysis?.company ?? job.fields.company}`
          : String(job.context.input?.url ?? job.kind);
        return {
          id: job.id,
          kind: job.kind,
          applicationId: job.applicationId,
          title: title.slice(0, 300),
          step: parsedStep,
          status: job.status,
          startedAt: job.createdAt.toISOString(),
          updatedAt: job.updatedAt.toISOString(),
        };
      }),
      queues,
      providers: providers.success ? providers.data : [],
    };
  }

  async releaseProvider(providerId: string) {
    // The gateway owns the pause; the steps it held go out at once.
    await getJson(
      `${this.services.llm.url}/v1/providers/${encodeURIComponent(providerId)}/pause`,
      this.services.llm.token,
      5000,
      "DELETE",
    );
    const released = await this.orchestrator.releaseQuotaPauses();
    // The provider as it is now (the web shows its state right away), plus
    // how many held steps went out.
    const providers = await getJson(
      `${this.services.llm.url}/v1/providers`,
      this.services.llm.token,
      5000,
    ).catch(() => null);
    const status = llmProviderStatusSchema
      .array()
      .safeParse(providers)
      .data?.find((item) => item.id === providerId) ?? {
      id: providerId,
      available: true,
      reason: null,
      pausedUntil: null,
      concurrency: 1,
      inFlight: 0,
    };
    return { ...status, released };
  }
}
