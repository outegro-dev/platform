import {
  applyRepair,
  assembleCv,
  atsCoverage,
  type ComposeOutput,
  type CvDraft,
  composePrompt,
  type Finding,
  type Match,
  matchPrompt,
  partRules,
  prefilterCases,
  type RepairPatch,
  repairPrompt,
  reviewPrompt,
  rolePolicy,
  type Selection,
  selectCases,
  sourceFallback,
} from "@outegro/atelier-engine";
import {
  type Profile,
  profileSchema,
  type Requirement,
  requirementSchema,
  type VacancyAnalysis,
  vacancyAnalysisSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import { cvText, json, listOf } from "./common.js";
import { fail, ok, PortError, type StepHandler } from "./step-handler.js";

const base = { profile: profileSchema, analysis: vacancyAnalysisSchema };
type Base = { profile: Profile; analysis: VacancyAnalysis };

/** match: requirements × the user's cases the code let through, by the model. */
export const matchStep: StepHandler<Base> = {
  type: "match",
  contract: 1,
  input: z.object(base),
  async handle(task, ctx) {
    const { profile, analysis } = task.input;
    const cases = prefilterCases(profile.bank.cases, analysis.requirements);
    if (!cases.length) return ok({ matches: [], cases: 0 });
    const answer = await ctx.llm.generate<unknown>(
      matchPrompt(analysis.requirements, cases),
    );
    return ok({
      matches: listOf<Match>(answer, "matches"),
      cases: cases.length,
    });
  },
};

/** select: company quotas and the best set of cases, by code. */
export const selectStep: StepHandler<Base & { matches: Match[] }> = {
  type: "select",
  contract: 1,
  input: z.object({ ...base, matches: z.array(json<Match>("match")) }),
  async handle(task) {
    const { profile, analysis, matches } = task.input;
    const policy = rolePolicy(analysis.requirements, analysis.title);
    const selection = selectCases(
      profile,
      analysis.requirements,
      matches,
      policy,
    );
    if (selection.status !== "ok")
      return fail(
        "needs_edit",
        selection.warnings.join("; ") ||
          "a company is below its minimum of cases",
        { selection },
      );
    return ok({ selection });
  },
};

/** compose: the About and the adapted full bullets of the selected cases. */
export const composeStep: StepHandler<Base & { selection: Selection }> = {
  type: "compose",
  contract: 1,
  input: z.object({ ...base, selection: json<Selection>("selection") }),
  async handle(task, ctx) {
    const compose = await ctx.llm.generate<ComposeOutput>(
      composePrompt(task.input),
    );
    return ok({ compose });
  },
};

/** adapt: the draft by code (title, tenure, skills, order), then the part rules. */
export const adaptStep: StepHandler<
  Base & { selection: Selection; compose: ComposeOutput }
> = {
  type: "adapt",
  contract: 1,
  input: z.object({
    ...base,
    selection: json<Selection>("selection"),
    compose: json<ComposeOutput>("compose"),
  }),
  async handle(task) {
    const { profile, analysis, selection, compose } = task.input;
    const assembled = assembleCv(profile, analysis, selection, compose);
    const { draft, replaced } = partRules(assembled, profile);
    return ok({ draft, replaced });
  },
};

/** review: facts and plausibility; the answer is findings only. */
export const reviewStep: StepHandler<Base & { draft: CvDraft }> = {
  type: "review",
  contract: 1,
  input: z.object({ ...base, draft: json<CvDraft>("draft") }),
  async handle(task, ctx) {
    const answer = await ctx.llm.generate<unknown>(reviewPrompt(task.input));
    return ok({ findings: listOf<Finding>(answer, "findings") });
  },
};

/**
 * repair: the flagged parts only, once. An unusable answer is not fatal:
 * fallback then takes the bank's wording for what the review flagged.
 */
export const repairStep: StepHandler<
  Base & { draft: CvDraft; findings: Finding[] }
> = {
  type: "repair",
  contract: 1,
  input: z.object({
    ...base,
    draft: json<CvDraft>("draft"),
    findings: z.array(json<Finding>("finding")),
  }),
  async handle(task, ctx) {
    const { draft, profile } = task.input;
    let prompt: ReturnType<typeof repairPrompt>;
    try {
      prompt = repairPrompt(task.input);
    } catch (error) {
      // No finding points at a part a repair may touch: fallback answers it.
      return ok({ draft, repaired: false, note: (error as Error).message });
    }
    try {
      const patch = await ctx.llm.generate<RepairPatch>(prompt);
      const ruled = partRules(applyRepair(draft, patch), profile);
      return ok({
        draft: ruled.draft,
        replaced: ruled.replaced,
        repaired: true,
      });
    } catch (error) {
      if (error instanceof PortError && error.code === "invalid_output")
        return ok({ draft, repaired: false, note: error.message });
      throw error;
    }
  },
};

/** fallback: what review could not confirm takes the candidate's own text. */
export const fallbackStep: StepHandler<{
  profile: Profile;
  draft: CvDraft;
  findings: Finding[];
}> = {
  type: "fallback",
  contract: 1,
  input: z.object({
    profile: profileSchema,
    draft: json<CvDraft>("draft"),
    findings: z.array(json<Finding>("finding")),
  }),
  async handle(task) {
    const { draft, findings, profile } = task.input;
    const result = sourceFallback(draft, findings, profile);
    return ok({ draft: result.draft, sourced: result.sourced });
  },
};

/** ats-check: share of the must-terms in the CV text (from the document). */
export const atsCheckStep: StepHandler<{
  document: Parameters<typeof cvText>[0];
  requirements: Requirement[];
}> = {
  type: "ats-check",
  contract: 1,
  input: z.object({
    document: json<Parameters<typeof cvText>[0]>("document"),
    requirements: z.array(requirementSchema),
  }),
  async handle(task) {
    // atelier-tex returns no text layer: the CV text comes from the document
    // it rendered, in reading order.
    const result = atsCoverage(
      cvText(task.input.document),
      task.input.requirements,
    );
    return ok(result);
  },
};

/** store: the files fit uploaded are there; the clean name for serving. */
export const storeStep: StepHandler<{
  versionId: string;
  pdfKey: string;
  texKey: string;
  fileName: string;
}> = {
  type: "store",
  contract: 1,
  input: z.object({
    versionId: z.uuid(),
    pdfKey: z.string().min(1),
    texKey: z.string().min(1),
    fileName: z.string().min(1).max(200),
  }),
  async handle(task, ctx) {
    const [pdf, tex] = await Promise.all([
      ctx.storage.head(task.input.pdfKey),
      ctx.storage.head(task.input.texKey),
    ]);
    if (!pdf || !tex)
      return fail("cv_missing", "the fitted PDF or TeX is not in storage");
    return ok({
      versionId: task.input.versionId,
      storageKey: pdf.key,
      texKey: tex.key,
      fileName: task.input.fileName,
      size: pdf.size,
      sha256: pdf.sha256,
    });
  },
};
