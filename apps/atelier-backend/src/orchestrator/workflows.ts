import type { Profile } from "@outegro/contracts/atelier";
import { and, desc, eq, inArray, isNull, lt, max, sql } from "drizzle-orm";
import { publishVacancy } from "../catalog/catalog.js";
import type { AtelierTx } from "../common/database.js";
import { cvFileName, linkHash } from "../cv-links/naming.js";
import {
  answers,
  applications,
  contacts,
  cvLinks,
  cvVersions,
  jobSteps,
  jobs,
  materials,
  vacancies,
} from "../db/schema.js";
import { cvKeys } from "../storage/storage.js";
import { addFlag, addHistory, removeFlags, setStage } from "./board-ops.js";
import {
  ANALYSIS_VERSION,
  analyzeOutputSchema,
  atsOutputSchema,
  channelOutputSchema,
  fieldsOutputSchema,
  fitOutputSchema,
  matchOutputSchema,
  selectOutputSchema,
  sendOutputSchema,
  storeOutputSchema,
  structureOutputSchema,
  textsOutputSchema,
} from "./outputs.js";
import { type FlowContext, StepRefusal, type Workflow } from "./workflow.js";

const minutes = (n: number) => n * 60_000;

/* ---------- reading the context ---------- */

const input = (ctx: FlowContext) => ctx.job.context.input ?? {};
const inputString = (ctx: FlowContext, key: string) => {
  const value = input(ctx)[key];
  return typeof value === "string" && value.trim() ? value : null;
};

function profileOf(ctx: FlowContext): Profile {
  if (!ctx.profile)
    throw new StepRefusal(
      "no_profile",
      "the user has no profile; import it first",
    );
  return ctx.profile;
}

function vacancyOf(ctx: FlowContext) {
  if (!ctx.vacancy)
    throw new StepRefusal("no_vacancy", "the job has no vacancy");
  return ctx.vacancy;
}

function analysisOf(ctx: FlowContext) {
  const analysis = vacancyOf(ctx).analysis;
  if (!analysis)
    throw new StepRefusal("no_analysis", "the vacancy has no analysis yet");
  return analysis;
}

function applicationOf(ctx: FlowContext) {
  if (!ctx.application)
    throw new StepRefusal("no_application", "the job has no application");
  return ctx.application;
}

/** Output of an earlier step of this job, checked against what it must hold. */
function outputOf<T>(
  ctx: FlowContext,
  step: string,
  schema: { parse(value: unknown): T },
): T {
  if (!(step in ctx.outputs))
    throw new StepRefusal("missing_output", `step ${step} has no output`);
  return schema.parse(ctx.outputs[step]);
}

/** Raw output of an earlier step (drafts the orchestrator passes on untouched). */
function rawOutput(ctx: FlowContext, step: string, key: string): unknown {
  const output = ctx.outputs[step];
  if (output && typeof output === "object" && key in output)
    return (output as Record<string, unknown>)[key];
  throw new StepRefusal("missing_output", `step ${step} has no ${key}`);
}

const fieldsOf = (ctx: FlowContext) =>
  outputOf(
    ctx,
    "fetch" in ctx.outputs ? "fetch" : "extract",
    fieldsOutputSchema,
  ).fields;

/* ---------- vacancy.ingest ---------- */

/** fetch (or extract a pasted text) → structure → publish to the catalog. */
export const vacancyIngest: Workflow = {
  kind: "vacancy.ingest",
  version: 1,
  steps: [
    {
      step: "fetch",
      type: "fetch",
      contract: 1,
      skip: (ctx) => (inputString(ctx, "text") ? "the text was given" : null),
      input: (ctx) => ({ url: inputString(ctx, "url") }),
    },
    {
      step: "extract",
      type: "extract",
      contract: 1,
      skip: (ctx) => (inputString(ctx, "text") ? null : "the page was fetched"),
      input: (ctx) => ({
        text: inputString(ctx, "text"),
        url: inputString(ctx, "url"),
        manualUrl: `${inputString(ctx, "manualBase") ?? "https://atelier.outegro.dev/manual"}/${ctx.job.id}`,
      }),
    },
    {
      step: "structure",
      type: "structure",
      contract: 1,
      input: (ctx) => ({ fields: fieldsOf(ctx) }),
    },
    {
      step: "dedupe",
      type: "dedupe",
      local: async (tx, ctx) => {
        const fields = fieldsOf(ctx);
        const { structure, keys } = outputOf(
          ctx,
          "structure",
          structureOutputSchema,
        );
        const { vacancy, duplicate } = await publishVacancy(tx, {
          fields,
          structure,
          keys,
          now: ctx.now,
        });
        await tx
          .update(jobs)
          .set({ vacancyId: vacancy.id })
          .where(eq(jobs.id, ctx.job.id));
        ctx.job.vacancyId = vacancy.id;
        return { status: "ok", output: { vacancyId: vacancy.id, duplicate } };
      },
    },
  ],
  /** Added by hand: the owner's card and its build follow at once. */
  onDone: async (tx, ctx) => {
    const followUp = input(ctx).followUp as
      | { userId?: string; kinds?: string[] }
      | undefined;
    const vacancyId = ctx.job.vacancyId;
    if (!followUp?.userId || !vacancyId) return;
    await startBuildFor(tx, ctx, followUp.userId, vacancyId, {
      kinds: followUp.kinds ?? [],
    });
  },
};

/** The user's card for a vacancy (created on the way) and its build job. */
export async function startBuildFor(
  tx: AtelierTx,
  ctx: Pick<FlowContext, "start" | "now">,
  userId: string,
  vacancyId: string,
  buildInput: Record<string, unknown> = {},
  score: number | null = null,
) {
  await tx
    .insert(applications)
    .values({
      userId,
      vacancyId,
      stage: "fit",
      score,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing();
  const [application] = await tx
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.userId, userId),
        eq(applications.vacancyId, vacancyId),
      ),
    );
  if (!application) throw new Error("application vanished");
  // One build per card at a time.
  const [running] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.applicationId, application.id),
        eq(jobs.kind, "application.build"),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (running) return { applicationId: application.id, jobId: running.id };
  if (["found", "fit"].includes(application.stage))
    await setStage(tx, application.id, "building", ctx.now);
  await addHistory(tx, application.id, {
    at: ctx.now,
    action: "build started",
  });
  const jobId = await ctx.start(tx, {
    kind: "application.build",
    userId,
    vacancyId,
    applicationId: application.id,
    input: buildInput,
  });
  return { applicationId: application.id, jobId };
}

/* ---------- vacancy.analyze ---------- */

const analysisCached = (ctx: FlowContext) =>
  ctx.vacancy?.analysis && ctx.vacancy.analysisVersion === ANALYSIS_VERSION
    ? "analysis cached for this vacancy"
    : null;

const analyzeStep = {
  step: "analyze",
  type: "analyze" as const,
  contract: 1,
  deadlineMs: minutes(20),
  skip: analysisCached,
  input: (ctx: FlowContext) => ({
    fields: vacancyOf(ctx).fields,
    version: ANALYSIS_VERSION,
  }),
  apply: async (tx: AtelierTx, ctx: FlowContext, output: unknown) => {
    const { analysis, version } = analyzeOutputSchema.parse(output);
    const vacancy = vacancyOf(ctx);
    // A pasted text has no page title or company: the analysis names them.
    const fields =
      vacancy.fields.provider === "manual"
        ? {
            ...vacancy.fields,
            title: analysis.title,
            company: analysis.company,
          }
        : vacancy.fields;
    await tx
      .update(vacancies)
      .set({ analysis, analysisVersion: version, fields, updatedAt: ctx.now })
      .where(eq(vacancies.id, vacancy.id));
    vacancy.analysis = analysis;
    vacancy.analysisVersion = version;
    vacancy.fields = fields;
  },
};

/** analyze → ground, cached on the vacancy for every user. */
export const vacancyAnalyze: Workflow = {
  kind: "vacancy.analyze",
  version: 1,
  steps: [analyzeStep],
};

/* ---------- application.build ---------- */

const findingsOf = (ctx: FlowContext) => {
  const findings = rawOutput(ctx, "review", "findings");
  return Array.isArray(findings) ? findings : [];
};

/** The draft the last editing step left: repair when it ran and changed it, else adapt. */
function editedDraft(ctx: FlowContext) {
  const repair = ctx.outputs.repair as
    | { draft?: unknown; repaired?: boolean }
    | undefined;
  return repair?.repaired && repair.draft
    ? repair.draft
    : rawOutput(ctx, "adapt", "draft");
}

const cvVersionIdOf = (ctx: FlowContext) => {
  const id = ctx.job.context.cvVersionId;
  if (!id)
    throw new StepRefusal("no_cv_version", "the job reserved no CV version");
  return id;
};

/**
 * Work Finder's CV v2 step for step: match → select → compose → adapt →
 * review → repair (once, only with findings) → fallback → fit (one task,
 * ≤ 12 renders) → ats-check → store → texts.
 */
export const applicationBuild: Workflow = {
  kind: "application.build",
  version: 1,
  steps: [
    analyzeStep,
    {
      step: "match",
      type: "match",
      contract: 1,
      deadlineMs: minutes(20),
      input: (ctx) => ({ profile: profileOf(ctx), analysis: analysisOf(ctx) }),
    },
    {
      step: "select",
      type: "select",
      contract: 1,
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        matches: outputOf(ctx, "match", matchOutputSchema).matches,
      }),
      apply: async (tx, ctx, output) => {
        const { selection } = selectOutputSchema.parse(output);
        const score = selection.utility ?? selection.reqCoverage;
        if (score === undefined) return;
        await tx
          .update(applications)
          .set({
            score: Math.max(0, Math.min(100, Math.round(score * 10) / 10)),
            updatedAt: ctx.now,
          })
          .where(eq(applications.id, applicationOf(ctx).id));
      },
    },
    {
      step: "compose",
      type: "compose",
      contract: 1,
      deadlineMs: minutes(20),
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        selection: rawOutput(ctx, "select", "selection"),
      }),
    },
    {
      step: "adapt",
      type: "adapt",
      contract: 1,
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        selection: rawOutput(ctx, "select", "selection"),
        compose: rawOutput(ctx, "compose", "compose"),
      }),
    },
    {
      step: "review",
      type: "review",
      contract: 1,
      deadlineMs: minutes(20),
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        draft: rawOutput(ctx, "adapt", "draft"),
      }),
    },
    {
      step: "repair",
      type: "repair",
      contract: 1,
      deadlineMs: minutes(20),
      skip: (ctx) =>
        findingsOf(ctx).length ? null : "the review found nothing",
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        draft: rawOutput(ctx, "adapt", "draft"),
        findings: findingsOf(ctx),
      }),
    },
    {
      step: "fallback",
      type: "fallback",
      contract: 1,
      input: (ctx) => {
        const repaired = (
          ctx.outputs.repair as { repaired?: boolean } | undefined
        )?.repaired;
        return {
          profile: profileOf(ctx),
          draft: editedDraft(ctx),
          // A repaired draft answered its findings; otherwise what review
          // could not confirm goes back to the bank's own wording.
          findings: repaired ? [] : findingsOf(ctx),
        };
      },
    },
    {
      step: "fit",
      type: "fit",
      contract: 1,
      deadlineMs: minutes(30),
      input: (ctx) => {
        const application = applicationOf(ctx);
        return {
          profile: profileOf(ctx),
          analysis: analysisOf(ctx),
          draft: rawOutput(ctx, "fallback", "draft"),
          keys: cvKeys(application.userId, application.id, cvVersionIdOf(ctx)),
          maxRenders: 12,
        };
      },
    },
    {
      step: "ats-check",
      type: "ats-check",
      contract: 1,
      input: (ctx) => ({
        document: outputOf(ctx, "fit", fitOutputSchema).document,
        requirements: analysisOf(ctx).requirements,
      }),
    },
    {
      step: "store",
      type: "store",
      contract: 1,
      input: (ctx) => {
        const fit = outputOf(ctx, "fit", fitOutputSchema);
        const person = profileOf(ctx).person;
        return {
          versionId: cvVersionIdOf(ctx),
          pdfKey: fit.pdfKey,
          texKey: fit.texKey,
          fileName: cvFileName(person, analysisOf(ctx).cvRole),
        };
      },
      apply: async (tx, ctx, output) => {
        const stored = storeOutputSchema.parse(output);
        const fit = outputOf(ctx, "fit", fitOutputSchema);
        const ats = outputOf(ctx, "ats-check", atsOutputSchema);
        const application = applicationOf(ctx);
        await tx
          .insert(cvVersions)
          .values({
            id: stored.versionId,
            applicationId: application.id,
            jobId: ctx.job.id,
            storageKey: stored.storageKey,
            texKey: stored.texKey,
            fileName: stored.fileName,
            pages: fit.pages,
            atsCoverage: ats.coverage,
            missingTerms: ats.missingTerms,
            changes: fit.changes,
            document: fit.document,
            createdAt: ctx.now,
          })
          .onConflictDoNothing();
        await tx.insert(cvLinks).values({
          hash: linkHash(),
          cvVersionId: stored.versionId,
          createdAt: ctx.now,
        });
      },
    },
    {
      step: "texts",
      type: "texts",
      contract: 1,
      deadlineMs: minutes(20),
      input: (ctx) => ({
        profile: profileOf(ctx),
        analysis: analysisOf(ctx),
        fields: vacancyOf(ctx).fields,
        draft: rawOutput(ctx, "fallback", "draft"),
        kinds: Array.isArray(input(ctx).kinds) ? input(ctx).kinds : [],
        cvUrl: null,
      }),
      apply: async (tx, ctx, output) => {
        const { materials: texts } = textsOutputSchema.parse(output);
        const application = applicationOf(ctx);
        for (const text of texts) {
          const [last] = await tx
            .select({ version: max(materials.version) })
            .from(materials)
            .where(
              and(
                eq(materials.applicationId, application.id),
                eq(materials.kind, text.kind),
                eq(materials.locale, text.locale),
              ),
            );
          await tx.insert(materials).values({
            applicationId: application.id,
            kind: text.kind,
            locale: text.locale,
            subject: text.subject,
            body: text.body,
            version: (last?.version ?? 0) + 1,
            createdAt: ctx.now,
          });
        }
      },
    },
  ],
  onDone: async (tx, ctx) => {
    const application = applicationOf(ctx);
    if (["found", "fit", "building"].includes(application.stage))
      await setStage(tx, application.id, "ready", ctx.now);
    await removeFlags(
      tx,
      application.id,
      ["needs_edit", "needs_human"],
      ctx.now,
    );
    await addHistory(tx, application.id, { at: ctx.now, action: "CV built" });
  },
  onFailed: async (tx, ctx, reason) => {
    const application = applicationOf(ctx);
    await addFlag(tx, application.id, "needs_edit", ctx.now);
    await addHistory(tx, application.id, {
      at: ctx.now,
      action: "build failed",
      details: reason,
    });
  },
  onNeedsHuman: async (tx, ctx, reason) => {
    const application = applicationOf(ctx);
    await addFlag(tx, application.id, "needs_human", ctx.now);
    await addHistory(tx, application.id, {
      at: ctx.now,
      action: "build needs a person",
      details: reason,
    });
  },
};

/* ---------- application.send ---------- */

/** The draft of the card's last finished build (texts for form answers). */
async function lastDraft(tx: AtelierTx, applicationId: string) {
  const [row] = await tx
    .select({ output: jobSteps.output })
    .from(jobSteps)
    .innerJoin(jobs, eq(jobs.id, jobSteps.jobId))
    .where(
      and(
        eq(jobs.applicationId, applicationId),
        eq(jobs.kind, "application.build"),
        eq(jobs.status, "done"),
        eq(jobSteps.step, "fallback"),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1);
  return (row?.output as { draft?: unknown } | undefined)?.draft ?? null;
}

/** channel → send (browser prepare → answers → submit) → «Sent». */
export const applicationSend: Workflow = {
  kind: "application.send",
  version: 1,
  steps: [
    {
      step: "channel",
      type: "channel",
      contract: 1,
      input: (ctx) => ({ fields: vacancyOf(ctx).fields }),
      apply: async (tx, ctx, output) => {
        const { channel } = channelOutputSchema.parse(output);
        await tx
          .update(applications)
          .set({ channel, updatedAt: ctx.now })
          .where(eq(applications.id, applicationOf(ctx).id));
      },
    },
    {
      step: "send",
      type: "send",
      contract: 1,
      deadlineMs: minutes(30),
      input: async (ctx, tx) => {
        const application = applicationOf(ctx);
        const [cv] = await tx
          .select({
            storageKey: cvVersions.storageKey,
            fileName: cvVersions.fileName,
          })
          .from(cvVersions)
          .where(eq(cvVersions.applicationId, application.id))
          .orderBy(desc(cvVersions.createdAt))
          .limit(1);
        if (!cv) throw new StepRefusal("no_cv", "the card has no built CV");
        const [letter] = await tx
          .select({ body: materials.body })
          .from(materials)
          .where(
            and(
              eq(materials.applicationId, application.id),
              eq(materials.kind, "cover_letter"),
            ),
          )
          .orderBy(desc(materials.version))
          .limit(1);
        // Only the owner's own edits are reused; answers of the bank and the
        // model are worked out again on every send, so a fix applies at once.
        const known = await tx
          .select({ question: answers.question, answer: answers.answer })
          .from(answers)
          .where(
            and(
              eq(answers.applicationId, application.id),
              eq(answers.source, "manual"),
            ),
          );
        return {
          mode: input(ctx).mode === "prepare" ? "prepare" : "submit",
          channel: outputOf(ctx, "channel", channelOutputSchema),
          profile: profileOf(ctx),
          fields: vacancyOf(ctx).fields,
          analysis: vacancyOf(ctx).analysis,
          draft: await lastDraft(tx, application.id),
          cv,
          coverLetter: letter?.body ?? null,
          answers: known,
        };
      },
      apply: async (tx, ctx, output) => {
        const sent = sendOutputSchema.parse(output);
        const application = applicationOf(ctx);
        for (const answer of sent.answers)
          await tx
            .insert(answers)
            .values({
              applicationId: application.id,
              ...answer,
              createdAt: ctx.now,
            })
            .onConflictDoUpdate({
              target: [answers.applicationId, answers.question],
              set: { answer: answer.answer, source: answer.source },
            });
      },
    },
  ],
  onDone: async (tx, ctx) => {
    const application = applicationOf(ctx);
    const channel = outputOf(ctx, "channel", channelOutputSchema);
    const sent = outputOf(ctx, "send", sendOutputSchema);
    const submitted = sent.status === "submitted";
    await tx.insert(contacts).values({
      applicationId: application.id,
      kind: channel.channel,
      target: channel.target,
      status: submitted ? "sent" : "draft",
      sentAt: submitted ? ctx.now : null,
      note: sent.confirmation,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    if (submitted) {
      await tx
        .update(applications)
        .set({
          stage: "sent",
          archiveReason: null,
          sentAt: application.sentAt ?? ctx.now,
          updatedAt: ctx.now,
        })
        .where(eq(applications.id, application.id));
      await removeFlags(tx, application.id, ["needs_human"], ctx.now);
    }
    await addHistory(tx, application.id, {
      at: ctx.now,
      action: submitted
        ? `sent via ${channel.channel}`
        : "form prepared, not sent",
      details: sent.confirmation ?? channel.target,
    });
  },
  onNeedsHuman: async (tx, ctx, reason) => {
    const application = applicationOf(ctx);
    const channel = ctx.outputs.channel
      ? channelOutputSchema.safeParse(ctx.outputs.channel)
      : null;
    if (channel?.success)
      await tx.insert(contacts).values({
        applicationId: application.id,
        kind: channel.data.channel,
        target: channel.data.target,
        status: "draft",
        note: reason.slice(0, 1000),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    await addFlag(tx, application.id, "needs_human", ctx.now);
    await addHistory(tx, application.id, {
      at: ctx.now,
      action: "sending needs a person",
      details: reason,
    });
  },
  onFailed: async (tx, ctx, reason) => {
    const application = applicationOf(ctx);
    await addFlag(tx, application.id, "needs_human", ctx.now);
    await addHistory(tx, application.id, {
      at: ctx.now,
      action: "sending failed",
      details: reason,
    });
  },
};

/* ---------- tick.daily ---------- */

const days = (n: number) => n * 24 * 3600_000;

/** Once a day: liveness (later), follow-up after 7 days, «no answer» after 21. */
export const tickDaily: Workflow = {
  kind: "tick.daily",
  version: 1,
  steps: [
    {
      step: "liveness",
      type: null,
      // TODO(liveness): a worker task over atelier-sources checkLiveness for
      // vacancies with cards in sent…final; closed ones archive as `closed`.
      local: async () => ({
        status: "skipped",
        note: "liveness checks are not automated yet",
      }),
    },
    {
      step: "follow-up",
      type: null,
      local: async (tx, ctx) => {
        const due = await tx
          .update(applications)
          .set({
            flags: sql`array_append(${applications.flags}, 'follow_up')`,
            updatedAt: ctx.now,
          })
          .where(
            and(
              eq(applications.stage, "sent"),
              lt(applications.sentAt, new Date(ctx.now.getTime() - days(7))),
              sql`not ('follow_up' = any(${applications.flags}))`,
            ),
          )
          .returning({ id: applications.id });
        for (const { id } of due)
          await addHistory(tx, id, {
            at: ctx.now,
            action: "follow-up due",
            details: "7 days without an answer",
          });
        return { status: "ok", output: { flagged: due.length } };
      },
    },
    {
      step: "ghosting",
      type: null,
      local: async (tx, ctx) => {
        const gone = await tx
          .update(applications)
          .set({
            stage: "archived",
            archiveReason: "ghosted",
            updatedAt: ctx.now,
          })
          .where(
            and(
              eq(applications.stage, "sent"),
              lt(applications.sentAt, new Date(ctx.now.getTime() - days(21))),
              isNull(applications.archiveReason),
            ),
          )
          .returning({ id: applications.id });
        for (const { id } of gone)
          await addHistory(tx, id, {
            at: ctx.now,
            action: "archived: no answer",
            details: "21 days without an answer",
          });
        return { status: "ok", output: { archived: gone.length } };
      },
    },
  ],
};

/** Every workflow by kind and version; jobs finish on their own version. */
export const workflows: Record<string, Record<number, Workflow>> = {};
for (const workflow of [
  vacancyIngest,
  vacancyAnalyze,
  applicationBuild,
  applicationSend,
  tickDaily,
]) {
  workflows[workflow.kind] = {
    ...(workflows[workflow.kind] ?? {}),
    [workflow.version]: workflow,
  };
}

export function workflowOf(kind: string, version?: number): Workflow {
  const versions = workflows[kind];
  if (!versions) throw new Error(`unknown workflow ${kind}`);
  const chosen =
    version ?? Math.max(...Object.keys(versions).map((key) => Number(key)));
  const workflow = versions[chosen];
  if (!workflow) throw new Error(`unknown workflow ${kind} v${chosen}`);
  return workflow;
}
