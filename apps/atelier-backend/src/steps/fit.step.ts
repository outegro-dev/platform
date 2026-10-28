import {
  type CvDraft,
  type FitState,
  initialFitState,
  nextFitStep,
  toCvDocument,
} from "@outegro/atelier-engine";
import {
  type CvDocument,
  type Profile,
  profileSchema,
  type TexRenderResponse,
  type VacancyAnalysis,
  vacancyAnalysisSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import { json } from "./common.js";
import { fail, ok, type StepHandler } from "./step-handler.js";

type FitInput = {
  profile: Profile;
  analysis: VacancyAnalysis;
  draft: CvDraft;
  keys: { pdf: string; tex: string };
  maxRenders: number;
};

/**
 * fit: render → measure → shorten, up to 12 renders inside this one task
 * (no round trip per render). The accepted render's PDF and TeX go to
 * storage under the CV version's keys; only the keys travel on.
 */
export const fitStep: StepHandler<FitInput> = {
  type: "fit",
  contract: 1,
  input: z.object({
    profile: profileSchema,
    analysis: vacancyAnalysisSchema,
    draft: json<CvDraft>("draft"),
    keys: z.object({ pdf: z.string().min(1), tex: z.string().min(1) }),
    maxRenders: z.number().int().min(1).max(12),
  }),
  async handle(task, ctx) {
    const { profile, analysis, draft, keys, maxRenders } = task.input;
    let state: FitState = initialFitState(draft);
    const renders = new Map<
      number,
      { document: CvDocument; render: TexRenderResponse }
    >();
    let reason = "no render accepted";
    for (let attempt = 1; attempt <= maxRenders; attempt++) {
      const document = toCvDocument(profile, draft, state, analysis);
      const render = await ctx.tex.render({ document, font: profile.font });
      renders.set(attempt, { document, render });
      const step = nextFitStep(state, draft, render, attempt);
      state = step.state;
      reason = step.reason;
      if (step.action === "accept") break;
    }
    const accepted = state.accepted
      ? renders.get(state.accepted.attempt)
      : undefined;
    const history = state.history;
    if (!accepted)
      return fail("needs_edit", `fitting found no acceptable PDF: ${reason}`, {
        history,
        renders: renders.size,
      });
    await Promise.all([
      ctx.storage.put(
        keys.pdf,
        Buffer.from(accepted.render.pdfBase64, "base64"),
        "application/pdf",
      ),
      ctx.storage.put(
        keys.tex,
        Buffer.from(accepted.render.texSource, "utf8"),
        "application/x-tex",
      ),
    ]);
    ctx.log.info(
      { renders: renders.size, pages: accepted.render.pages },
      "CV fitted",
    );
    return ok({
      document: accepted.document,
      pages: accepted.render.pages,
      pdfKey: keys.pdf,
      texKey: keys.tex,
      changes: draft.changes,
      renders: renders.size,
      reason,
      history,
    });
  },
};
