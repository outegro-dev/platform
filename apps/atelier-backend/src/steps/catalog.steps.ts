import { analyzePrompt, groundRequirements } from "@outegro/atelier-engine";
import {
  fetchVacancy,
  structureVacancy,
  vacancyKeys,
} from "@outegro/atelier-sources";
import {
  type VacancyAnalysis,
  type VacancyFields,
  vacancyFieldsSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import { formAtsOf } from "./common.js";
import { fail, needsHuman, ok, type StepHandler } from "./step-handler.js";

/** fetch: the page by the cheapest tier that works (API, then HTTP). */
export const fetchStep: StepHandler<{ url: string }> = {
  type: "fetch",
  contract: 1,
  input: z.object({ url: z.url() }),
  async handle(task) {
    const result = await fetchVacancy(task.input.url);
    if (result.ok)
      return ok({
        fields: result.fields,
        tier: result.tier,
        source: result.source,
      });
    if (result.status === "closed")
      return fail("vacancy_closed", result.reason);
    if (result.status === "browser")
      return needsHuman(`the page needs a browser: ${result.reason}`);
    return {
      status: "retry",
      error: { code: "fetch_failed", message: result.reason, retryable: true },
    };
  },
};

const titleOf = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/^[#*\s-]+/, "").trim())
    .find((line) => line.length >= 3 && line.length <= 300) ?? "Vacancy";

/**
 * extract for a pasted text: fields by code; the analysis names the title
 * and company later (provider `manual`).
 */
export const extractStep: StepHandler<{
  text: string;
  url: string | null;
  manualUrl: string;
}> = {
  type: "extract",
  contract: 1,
  input: z.object({
    text: z.string().min(100).max(200_000),
    url: z.url().nullable(),
    manualUrl: z.url(),
  }),
  async handle(task) {
    const text = task.input.text
      .replace(/\r\n?/g, "\n")
      .replace(/[^\S\n]/g, " ")
      .trim();
    const url = task.input.url;
    const ats = formAtsOf(url);
    const fields: VacancyFields = vacancyFieldsSchema.parse({
      provider: "manual",
      url: url ?? task.input.manualUrl,
      originalUrl: null,
      applyUrl: ats ? url : null,
      ats,
      atsBoard: null,
      atsJobId: null,
      title: titleOf(text).slice(0, 300),
      company: "Unknown company",
      location: null,
      remote: /\bremote\b/i.test(text) ? true : null,
      postedAt: null,
      salary: null,
      text,
    });
    return ok({ fields, tier: "manual", source: "manual" });
  },
};

/** structure: level 2 by code, plus the catalog keys copies meet on. */
export const structureStep: StepHandler<{ fields: VacancyFields }> = {
  type: "structure",
  contract: 1,
  input: z.object({ fields: vacancyFieldsSchema }),
  async handle(task) {
    const { fields } = task.input;
    const structure = structureVacancy(fields.text, fields.title);
    const keys = vacancyKeys({
      url: fields.originalUrl ?? fields.url,
      text: fields.text,
      company: fields.company,
      title: fields.title,
      location: fields.location,
    });
    return ok({ structure, keys });
  },
};

/** analyze: one model call per vacancy, then the quotes are checked in the text. */
export const analyzeStep: StepHandler<{
  fields: VacancyFields;
  version: number;
}> = {
  type: "analyze",
  contract: 1,
  input: z.object({
    fields: vacancyFieldsSchema,
    version: z.number().int().positive(),
  }),
  async handle(task, ctx) {
    const analysis = await ctx.llm.generate<VacancyAnalysis>(
      analyzePrompt(task.input.fields),
    );
    try {
      const grounded = groundRequirements(analysis, task.input.fields.text);
      return ok({
        analysis: grounded.analysis,
        dropped: grounded.dropped,
        version: task.input.version,
      });
    } catch (error) {
      return {
        status: "retry",
        error: {
          code: "no_grounded_requirements",
          message: (error as Error).message,
          retryable: true,
        },
      };
    }
  },
};
