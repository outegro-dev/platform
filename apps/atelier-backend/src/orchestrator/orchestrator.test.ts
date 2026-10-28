import { randomUUID } from "node:crypto";
import {
  applicationDetailSchema,
  boardSchema,
  type VacancyFields,
} from "@outegro/contracts/atelier";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applications,
  cvLinks,
  cvVersions,
  history,
  jobSteps,
  jobs,
  materials,
  OWNER_PLACEHOLDER,
  outbox,
  profiles,
  vacancies,
} from "../db/schema.js";
import { ok, type StepOutcome } from "../steps/step-handler.js";
import {
  fakePdf,
  testAnalysis,
  testDocument,
  testFields,
  testProfile,
  vacancyText,
} from "../test/fixtures.js";
import {
  eventually,
  type Harness,
  ScriptedSteps,
  startHarness,
} from "../test/harness.js";
import { WorkerService } from "../worker/worker.service.js";
import { OrchestratorService } from "./orchestrator.service.js";

type Input = Record<string, unknown>;
const inputOf = (task: { input: unknown }) => task.input as Input;

/** Answers of a pipeline that works: schema-valid outputs, no model, no TeX. */
const script = new ScriptedSteps({
  extract: (task) => {
    const { text } = inputOf(task) as { text: string };
    return ok({
      fields: {
        ...testFields(),
        provider: "manual",
        text,
      } satisfies VacancyFields,
    });
  },
  fetch: (task) =>
    ok({
      fields: testFields(String(inputOf(task).url)),
      tier: "api",
      source: "lever",
    }),
  structure: (task) => {
    const fields = inputOf(task).fields as VacancyFields;
    return ok({
      structure: {
        technologies: ["Node.js", "TypeScript"],
        seniority: "senior",
        yearsMin: 5,
        remote: true,
        languages: [],
        roleFocus: "backend",
      },
      keys: {
        urlKey: fields.url,
        textKey: `text:${fields.url}`,
        roleKey: `role:${fields.url}`,
      },
    });
  },
  analyze: () => ok({ analysis: testAnalysis, dropped: [], version: 1 }),
  match: () =>
    ok({
      matches: [
        {
          requirementId: "R1",
          caseId: "A1",
          match: 1,
          evidenceRefs: ["A1:core"],
        },
      ],
    }),
  select: () =>
    ok({
      selection: {
        status: "ok",
        utility: 71.4,
        reqCoverage: 80,
        coverage: [
          { requirementId: "R1", best: 1, caseIds: ["A1"] },
          { requirementId: "R2", best: 0, caseIds: [] },
        ],
      },
    }),
  compose: () => ok({ compose: { about: "…" } }),
  adapt: () =>
    ok({ draft: { title: "Senior Backend Engineer" }, replaced: [] }),
  review: () => ok({ findings: [] }),
  repair: (task) => ok({ draft: inputOf(task).draft, repaired: true }),
  fallback: (task) => ok({ draft: inputOf(task).draft, sourced: [] }),
  fit: async (task, ctx) => {
    const keys = inputOf(task).keys as { pdf: string; tex: string };
    await ctx.storage.put(keys.pdf, fakePdf, "application/pdf");
    await ctx.storage.put(
      keys.tex,
      Buffer.from("\\documentclass{article}"),
      "application/x-tex",
    );
    return ok({
      document: testDocument(),
      pages: 2,
      pdfKey: keys.pdf,
      texKey: keys.tex,
      changes: ["Title from the vacancy"],
    });
  },
  "ats-check": () => ok({ coverage: 0.9, missingTerms: ["Kafka"] }),
  store: async (task, ctx) => {
    const input = inputOf(task) as {
      versionId: string;
      pdfKey: string;
      texKey: string;
      fileName: string;
    };
    const pdf = await ctx.storage.head(input.pdfKey);
    if (!pdf)
      return {
        status: "fail",
        error: { code: "cv_missing", message: "no pdf", retryable: false },
      };
    return ok({
      versionId: input.versionId,
      storageKey: input.pdfKey,
      texKey: input.texKey,
      fileName: input.fileName,
      size: pdf.size,
      sha256: pdf.sha256,
    });
  },
  texts: () =>
    ok({
      materials: [
        {
          kind: "telegram",
          locale: "ru",
          subject: null,
          body: "Доброго времени суток!",
        },
        {
          kind: "email_ru",
          locale: "ru",
          subject: "Backend: Alex",
          body: "Здравствуйте!",
        },
      ],
    }),
  channel: (task) => {
    const fields = inputOf(task).fields as VacancyFields;
    return ok({
      channel: "ats_form",
      target: fields.applyUrl,
      ats: "lever",
      applyUrl: fields.applyUrl,
    });
  },
  send: () =>
    ok({
      status: "submitted",
      answers: [
        { question: "Notice period?", answer: "2 weeks", source: "bank" },
      ],
      confirmation: "Thank you for applying",
    }),
});

const retry = (code = "provider_unavailable"): StepOutcome => ({
  status: "retry",
  error: { code, message: `${code} (scripted)`, retryable: true },
});

let h: Harness;
const owner = randomUUID();

beforeAll(async () => {
  h = await startHarness(script);
  await h.db.insert(profiles).values({ userId: owner, data: testProfile });
});
afterAll(async () => h?.close());

async function jobOf(id: string) {
  const [job] = await h.db.select().from(jobs).where(eq(jobs.id, id));
  return job;
}
const stepOf = async (jobId: string, step: string) =>
  (
    await h.db
      .select()
      .from(jobSteps)
      .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.step, step)))
  )[0];

const waitFor = (jobId: string, status: string, timeoutMs = 30_000) =>
  eventually(
    async () => (await jobOf(jobId))?.status === status,
    timeoutMs,
    `job ${status}`,
  );

/** Lets every pending task go now (instead of waiting out a backoff). */
const releaseOutbox = () =>
  h.db
    .update(outbox)
    .set({ availableAt: new Date(Date.now() - 1000) })
    .where(eq(outbox.status, "pending"));

async function buildJobFor(applicationId: string) {
  return eventually(async () => {
    const [job] = await h.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.applicationId, applicationId),
          eq(jobs.kind, "application.build"),
        ),
      );
    return job;
  });
}

describe("orchestrator", () => {
  let applicationId: string;

  it("runs a pasted vacancy from ingest to a ready card with a CV, a link and texts", async () => {
    const auth = await h.auth(owner);
    const added = await h
      .http()
      .post("/v1/vacancies")
      .set(auth)
      .send({ text: vacancyText })
      .expect(202);
    await waitFor(added.body.jobId, "done");
    const ingest = await jobOf(added.body.jobId);
    expect((await stepOf(added.body.jobId, "fetch"))?.status).toBe("skipped");
    expect((await stepOf(added.body.jobId, "dedupe"))?.status).toBe("done");
    const [card] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.vacancyId, ingest?.vacancyId as string));
    applicationId = card?.id as string;
    const build = await buildJobFor(applicationId);
    await waitFor(build.id, "done");

    const [application] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    expect(application).toMatchObject({ stage: "ready", score: 71.4 });
    const [vacancy] = await h.db
      .select()
      .from(vacancies)
      .where(eq(vacancies.id, application?.vacancyId as string));
    expect(vacancy?.analysis?.company).toBe("Examplecorp");
    // A pasted text takes the analysis' company and title.
    expect(vacancy?.fields.company).toBe("Examplecorp");
    expect((await stepOf(build.id, "repair"))?.status).toBe("skipped");
    const [cv] = await h.db
      .select()
      .from(cvVersions)
      .where(eq(cvVersions.applicationId, applicationId));
    expect(cv).toMatchObject({
      fileName: "Alex_Example_Senior_Backend_Engineer_CV.pdf",
      pages: 2,
      atsCoverage: 0.9,
      storageKey: `cv/${owner}/${applicationId}/${cv?.id}.pdf`,
    });
    expect(
      await h.db
        .select()
        .from(materials)
        .where(eq(materials.applicationId, applicationId)),
    ).toHaveLength(2);

    const board = await h.http().get("/v1/board").set(auth).expect(200);
    boardSchema.parse(board.body);
    expect(
      board.body.columns.find(
        (column: { stage: string }) => column.stage === "ready",
      ).items,
    ).toHaveLength(1);
    const detail = await h
      .http()
      .get(`/v1/applications/${applicationId}`)
      .set(auth)
      .expect(200);
    const parsed = applicationDetailSchema.parse(detail.body);
    expect(parsed.cv?.shareUrl).toMatch(
      /^http:\/\/cv\.test\/[0-9A-Za-z]{12}\/Alex_Example_Senior_Backend_Engineer_CV\.pdf$/,
    );
    expect(parsed.fit?.requirements.map((item) => item.label)).toEqual([
      "direct",
      "missing",
    ]);
    expect(parsed.pipeline.find((step) => step.step === "fit")?.status).toBe(
      "ok",
    );
    expect(parsed.history.map((item) => item.action)).toEqual([
      "build started",
      "CV built",
    ]);

    const download = await h
      .http()
      .get(`/v1/applications/${applicationId}/cv.pdf`)
      .set(auth)
      .expect(200);
    expect(download.headers["content-disposition"]).toContain(
      'attachment; filename="Alex_Example_Senior_Backend_Engineer_CV.pdf"',
    );
  });

  it("serves the public link: redirects, bots and the owner not counted, first open flags the card", async () => {
    const [link] = await h.db
      .select({ hash: cvLinks.hash, fileName: cvVersions.fileName })
      .from(cvLinks)
      .innerJoin(cvVersions, eq(cvVersions.id, cvLinks.cvVersionId))
      .where(eq(cvVersions.applicationId, applicationId));
    if (!link) throw new Error("no link");
    const short = await h.http().get(`/cv/${link.hash}`).expect(302);
    expect(short.headers.location).toBe(
      `http://cv.test/${link.hash}/${link.fileName}`,
    );
    const wrong = await h.http().get(`/cv/${link.hash}/cv.pdf`).expect(301);
    expect(wrong.headers.location).toBe(
      `http://cv.test/${link.hash}/${link.fileName}`,
    );
    await h.http().get(`/cv/AAAAAAAAAAAA/${link.fileName}`).expect(404);

    const bot = await h
      .http()
      .get(`/cv/${link.hash}/${link.fileName}`)
      .set("user-agent", "TelegramBot (like TwitterBot)")
      .expect(200);
    expect(bot.headers["content-type"]).toBe("application/pdf");
    expect(bot.headers["content-disposition"]).toContain(
      'inline; filename="Alex_Example_Senior_Backend_Engineer_CV.pdf"',
    );
    expect(bot.headers["x-robots-tag"]).toContain("noindex");
    await h
      .http()
      .get(`/cv/${link.hash}/${link.fileName}`)
      .set("user-agent", "Mozilla/5.0 Firefox/131.0")
      .set(await h.auth(owner))
      .expect(200);
    const device = await h
      .http()
      .get("/v1/cv-links/device")
      .set(await h.auth(owner))
      .expect(200);
    const mark = String(device.body.url).split("/").at(-1);
    await h
      .http()
      .get(`/cv/${link.hash}/${link.fileName}`)
      .set("user-agent", "Mozilla/5.0 Firefox/131.0")
      .set("cookie", `atelier_owner=${mark}`)
      .expect(200);
    const counted = async () =>
      (await h.db.select().from(cvLinks).where(eq(cvLinks.hash, link.hash)))[0];
    expect((await counted())?.opens).toBe(0);

    for (let i = 0; i < 2; i++)
      await h
        .http()
        .get(`/cv/${link.hash}/${link.fileName}`)
        .set("user-agent", "Mozilla/5.0 (Macintosh) Safari/605.1.15")
        .expect(200);
    expect((await counted())?.opens).toBe(2);
    const [card] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    expect(card?.flags).toEqual(["cv_opened"]);
    const opened = await h.db
      .select()
      .from(history)
      .where(
        and(
          eq(history.applicationId, applicationId),
          eq(history.action, "CV opened"),
        ),
      );
    expect(opened).toHaveLength(1);

    await h.db
      .update(cvLinks)
      .set({ revokedAt: new Date() })
      .where(eq(cvLinks.hash, link.hash));
    await h.http().get(`/cv/${link.hash}/${link.fileName}`).expect(410);
    await h.http().get(`/cv/${link.hash}`).expect(410);
    await h
      .http()
      .get("/cv/robots.txt")
      .expect(200)
      .expect("User-agent: *\nDisallow: /\n");
  });

  it("sends a ready card through the form and moves it to «Sent»", async () => {
    const auth = await h.auth(owner);
    const started = await h
      .http()
      .post(`/v1/applications/${applicationId}/send`)
      .set(auth)
      .send({})
      .expect(202);
    await waitFor(started.body.jobId, "done");
    const detail = applicationDetailSchema.parse(
      (
        await h
          .http()
          .get(`/v1/applications/${applicationId}`)
          .set(auth)
          .expect(200)
      ).body,
    );
    expect(detail.card).toMatchObject({ stage: "sent", channel: "ats_form" });
    expect(detail.card.sentAt).not.toBeNull();
    expect(detail.contacts).toMatchObject([
      { kind: "ats_form", status: "sent", note: "Thank you for applying" },
    ]);
    expect(detail.answers).toEqual([
      { question: "Notice period?", answer: "2 weeks" },
    ]);
    expect(detail.history.at(-1)?.action).toBe("sent via ats_form");
  });

  it("retries a failing step with backoff and keeps going after it", async () => {
    script.queue(
      "compose",
      () => retry(),
      () => retry(),
    );
    const before = script.count("compose");
    const { jobId } = await h
      .http()
      .post(`/v1/applications/${applicationId}/retry`)
      .set(await h.auth(owner))
      .send({ fromStep: "compose" })
      .expect(202)
      .then((response) => response.body as { jobId: string });
    // Steps before compose are reused, not run again.
    expect((await stepOf(jobId, "match"))?.note).toBe(
      "reused from the previous run",
    );
    const paused = await eventually(async () => {
      const step = await stepOf(jobId, "compose");
      return step?.status === "paused" && step.attempt === 2 ? step : undefined;
    });
    expect(paused.note).toMatch(/^retry 2 at /);
    expect(paused.dueAt && paused.dueAt.getTime() - Date.now()).toBeGreaterThan(
      5_000,
    );
    await releaseOutbox();
    await eventually(
      async () => (await stepOf(jobId, "compose"))?.attempt === 3,
    );
    await releaseOutbox();
    await waitFor(jobId, "done");
    expect(script.count("compose") - before).toBe(3);
    expect((await stepOf(jobId, "compose"))?.status).toBe("done");
  });

  it("fails the job after the last attempt and flags the card", async () => {
    script.queue(
      "review",
      () => retry(),
      () => retry(),
      () => retry(),
    );
    const jobId = await h
      .get(OrchestratorService)
      .retry(applicationId, "review");
    if (!jobId) throw new Error("no retry");
    for (const attempt of [2, 3]) {
      await eventually(async () => {
        const step = await stepOf(jobId, "review");
        return step?.status === "paused" && step.attempt === attempt;
      });
      await releaseOutbox();
    }
    await waitFor(jobId, "failed");
    expect((await stepOf(jobId, "review"))?.error?.message).toMatch(
      /^after 3 attempts/,
    );
    const [card] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    expect(card?.flags).toContain("needs_edit");
    const inbox = await h
      .http()
      .get("/v1/inbox")
      .set(await h.auth(owner))
      .expect(200);
    expect(inbox.body.tasks).toMatchObject([
      { applicationId, kind: "needs_edit" },
    ]);
  });

  it("pauses a step on a provider quota without counting the attempt, until the pause is lifted", async () => {
    const resetsAt = new Date(Date.now() + 3600_000).toISOString();
    script.queue("texts", () => ({ ...retry("provider_quota"), resetsAt }));
    const jobId = await h
      .get(OrchestratorService)
      .retry(applicationId, "texts");
    if (!jobId) throw new Error("no retry");
    const paused = await eventually(async () => {
      const step = await stepOf(jobId, "texts");
      return step?.status === "paused" ? step : undefined;
    });
    expect(paused).toMatchObject({
      attempt: 1,
      note: `quota: paused until ${resetsAt}`,
    });
    const [task] = await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventId, paused.taskId as string));
    expect(task?.availableAt.toISOString()).toBe(resetsAt);
    expect((await jobOf(jobId))?.status).toBe("running");
    const released = await h
      .http()
      .delete("/v1/providers/codex/pause")
      .set(await h.auth(owner))
      .expect(200);
    expect(released.body.released).toBe(1);
    await waitFor(jobId, "done");
    expect((await stepOf(jobId, "texts"))?.attempt).toBe(1);
  });

  it("applies a result once: duplicates and results of old tasks change nothing", async () => {
    const orchestrator = h.get(OrchestratorService);
    script.queue("ats-check", () => retry());
    const jobId = await orchestrator.retry(applicationId, "ats-check");
    if (!jobId) throw new Error("no retry");
    const first = await eventually(async () => {
      const step = await stepOf(jobId, "ats-check");
      return step?.status === "paused" ? step : undefined;
    });
    // A task no longer in flight (an earlier attempt): stale.
    const staleTaskId = randomUUID();
    expect(
      await orchestrator.handleResult({
        taskId: staleTaskId,
        jobId,
        type: "ats-check",
        status: "ok",
        output: { coverage: 0.1, missingTerms: [] },
      }),
    ).toBe("stale");
    const current = first.taskId as string;
    const result = {
      taskId: current,
      jobId,
      type: "ats-check" as const,
      status: "ok" as const,
      output: { coverage: 0.5, missingTerms: ["Go"] },
    };
    expect(await orchestrator.handleResult(result)).toBe("applied");
    // The same result again (a redelivery): a duplicate.
    expect(await orchestrator.handleResult(result)).toBe("duplicate");
    await waitFor(jobId, "done");
    expect((await stepOf(jobId, "ats-check"))?.output).toEqual({
      coverage: 0.5,
      missingTerms: ["Go"],
    });
  });

  it("replays a cached result for a redelivered task instead of running it again", async () => {
    const worker = h.get(WorkerService);
    const task = {
      id: randomUUID(),
      jobId: randomUUID(),
      type: "match" as const,
      contract: 1,
      attempt: 1,
      idempotencyKey: `test:${randomUUID()}`,
      userId: null,
      input: {},
      deadline: new Date(Date.now() + 60_000).toISOString(),
    };
    const before = script.count("match");
    await worker.run(task);
    await worker.run({ ...task, id: randomUUID() });
    expect(script.count("match") - before).toBe(1);
  });

  it("moves cards by hand with history, and skips from the inbox", async () => {
    const auth = await h.auth(owner);
    const moved = await h
      .http()
      .post(`/v1/applications/${applicationId}/stage`)
      .set(auth)
      .send({ stage: "hr" })
      .expect(200);
    expect(moved.body.stage).toBe("hr");
    const [last] = (
      await h.db
        .select()
        .from(history)
        .where(eq(history.applicationId, applicationId))
    ).slice(-1);
    expect(last).toMatchObject({
      action: "moved to hr",
      source: "manual",
      details: "from sent",
    });
    await h
      .http()
      .post(`/v1/applications/${applicationId}/stage`)
      .set(auth)
      .send({ stage: "hr", archiveReason: "hired" })
      .expect(400);
    await h
      .http()
      .post(`/v1/inbox/${applicationId}/skip`)
      .set(auth)
      .expect(200);
    const [card] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId));
    expect(card).toMatchObject({ stage: "archived", archiveReason: "skipped" });
  });

  it("archives a card without an answer for 21 days and flags follow-ups at 7 (tick.daily)", async () => {
    const [vacancy] = await h.db
      .select({ id: vacancies.id })
      .from(vacancies)
      .limit(1);
    const day = 86_400_000;
    const [old] = await h.db
      .insert(applications)
      .values({
        userId: randomUUID(),
        vacancyId: vacancy?.id as string,
        stage: "sent",
        sentAt: new Date(Date.now() - 22 * day),
      })
      .returning();
    const [quiet] = await h.db
      .insert(applications)
      .values({
        userId: randomUUID(),
        vacancyId: vacancy?.id as string,
        stage: "sent",
        sentAt: new Date(Date.now() - 8 * day),
      })
      .returning();
    const jobId = await h
      .get(OrchestratorService)
      .start({ kind: "tick.daily" });
    await waitFor(jobId, "done");
    const [a] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, old?.id as string));
    const [b] = await h.db
      .select()
      .from(applications)
      .where(eq(applications.id, quiet?.id as string));
    expect(a).toMatchObject({ stage: "archived", archiveReason: "ghosted" });
    expect(b?.flags).toEqual(["follow_up"]);
    expect((await stepOf(jobId, "liveness"))?.status).toBe("skipped");
  });

  it("lets the first signed-in owner adopt a profile imported for `owner`", async () => {
    const someone = randomUUID();
    await h.db
      .insert(profiles)
      .values({ userId: OWNER_PLACEHOLDER, data: testProfile });
    const [vacancy] = await h.db
      .select({ id: vacancies.id })
      .from(vacancies)
      .limit(1);
    await h.db.insert(applications).values({
      userId: OWNER_PLACEHOLDER,
      vacancyId: vacancy?.id as string,
      stage: "fit",
      score: 60,
    });
    // Without atelier.use nothing is adopted.
    await h
      .http()
      .get("/v1/board")
      .set(await h.auth(someone, []))
      .expect(403);
    const board = await h
      .http()
      .get("/v1/board")
      .set(await h.auth(someone))
      .expect(200);
    expect(board.body.stats.total).toBe(1);
    expect(
      await h.db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, OWNER_PLACEHOLDER)),
    ).toHaveLength(0);
    const profile = await h
      .http()
      .get("/v1/profile")
      .set(await h.auth(someone))
      .expect(200);
    expect(profile.body).toMatchObject({ name: "Alex Example", maxPages: 2 });
    expect(profile.body.cases).toHaveLength(2);
  });

  it("answers /health and refuses the API without a token", async () => {
    await h.http().get("/health").expect(200);
    await h.http().get("/v1/board").expect(401);
  });
});
