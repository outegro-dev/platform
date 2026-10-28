import {
  browserAtsSchema,
  channelKindSchema,
  cvDocumentSchema,
  vacancyAnalysisSchema,
  vacancyFieldsSchema,
  vacancyStructureSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";

/*
 * What the orchestrator reads from step outputs to change the database.
 * Workers send more (drafts, fitting history); that is kept in job_steps as
 * it came and passed to later steps untouched.
 */

/** Version of the analysis prompt; a cached analysis of another version is redone. */
export const ANALYSIS_VERSION = 1;

export const fieldsOutputSchema = z.object({
  fields: vacancyFieldsSchema,
  tier: z.string().nullish(),
  source: z.string().nullish(),
});

export const vacancyKeysSchema = z.object({
  urlKey: z.string().min(1),
  textKey: z.string().min(1),
  roleKey: z.string().min(1),
});
export type VacancyKeys = z.infer<typeof vacancyKeysSchema>;

export const structureOutputSchema = z.object({
  structure: vacancyStructureSchema,
  keys: vacancyKeysSchema,
});

export const analyzeOutputSchema = z.object({
  analysis: vacancyAnalysisSchema,
  dropped: z.array(z.unknown()).default([]),
  version: z.number().int().positive().default(ANALYSIS_VERSION),
});

const matchSchema = z.object({
  requirementId: z.string(),
  caseId: z.string(),
  match: z.number(),
  evidenceRefs: z.array(z.string()).default([]),
});
export type MatchRow = z.infer<typeof matchSchema>;

export const matchOutputSchema = z.object({ matches: z.array(matchSchema) });

/** The part of the engine's Selection the board shows. */
export const selectOutputSchema = z.object({
  selection: z
    .object({
      status: z.string(),
      utility: z.number().optional(),
      reqCoverage: z.number().optional(),
      coverage: z
        .array(
          z.object({
            requirementId: z.string(),
            best: z.number(),
            caseIds: z.array(z.string()),
          }),
        )
        .optional(),
      matches: z.array(matchSchema).optional(),
    })
    .loose(),
});

export const fitOutputSchema = z.object({
  document: cvDocumentSchema,
  pages: z.number().int().min(0),
  pdfKey: z.string().min(1),
  texKey: z.string().min(1),
  changes: z.array(z.string()).default([]),
  renders: z.number().int().min(0).optional(),
  reason: z.string().optional(),
});

export const atsOutputSchema = z.object({
  coverage: z.number().min(0).max(1),
  missingTerms: z.array(z.string()),
});

export const storeOutputSchema = z.object({
  versionId: z.uuid(),
  storageKey: z.string().min(1),
  texKey: z.string().min(1),
  fileName: z.string().min(1),
  size: z.number().int().min(0),
  sha256: z.string(),
});

export const materialOutputSchema = z.object({
  kind: z.string().min(1).max(60),
  locale: z.enum(["en", "ru"]),
  subject: z.string().nullable(),
  body: z.string().min(1),
});
export type MaterialOutput = z.infer<typeof materialOutputSchema>;

export const textsOutputSchema = z.object({
  materials: z.array(materialOutputSchema),
  issues: z.array(z.unknown()).default([]),
});

export const channelOutputSchema = z.object({
  channel: channelKindSchema,
  target: z.string(),
  ats: browserAtsSchema.nullable(),
  applyUrl: z.string().nullable(),
});
export type ChannelOutput = z.infer<typeof channelOutputSchema>;

export const answerOutputSchema = z.object({
  question: z.string().min(1),
  answer: z.string(),
  source: z.enum(["bank", "model", "manual"]),
});

export const sendOutputSchema = z.object({
  status: z.enum(["submitted", "prepared"]),
  answers: z.array(answerOutputSchema).default([]),
  confirmation: z.string().nullable().default(null),
  screenshotKey: z.string().nullable().default(null),
});
