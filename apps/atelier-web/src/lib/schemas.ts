import {
  applicationCardSchema,
  applicationStageSchema,
  archiveReasonSchema,
  atelierTaskTypeSchema,
  formAnswersSchema,
  llmProviderStatusSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";

/*
 * Wire shapes this app needs that @outegro/contracts/atelier does not have
 * yet (listed for the contract owner). Everything else is validated with
 * the contract's own schemas.
 */

/** GET /profile: what the profile screen shows (read-only). */
export const profileSummarySchema = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      company: z.string().min(1),
      title: z.string().min(1),
      technologies: z.array(z.string()),
      active: z.boolean(),
    }),
  ),
  form: formAnswersSchema,
  factsMode: z.enum(["free", "strict"]),
  maxPages: z.union([z.literal(1), z.literal(2)]),
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;

/** POST /vacancies: the ingest job (the application id once it exists). */
export const addVacancyResponseSchema = z.object({
  jobId: z.uuid(),
  applicationId: z.uuid().optional(),
});
export type AddVacancyResponse = z.infer<typeof addVacancyResponseSchema>;

/** POST /applications/:id/send and /retry: the job that does it. */
export const jobAcceptedSchema = z.object({ jobId: z.uuid() });
export type JobAccepted = z.infer<typeof jobAcceptedSchema>;

/** POST /applications/:id/stage and /inbox/:id/skip: the card as it is now. */
export const cardResponseSchema = applicationCardSchema;

/** DELETE /providers/:id/pause: the provider as it is now. */
export const providerResponseSchema = llmProviderStatusSchema;

/** Body of POST /api/atelier/applications/:id/retry. */
export const retryRequestSchema = z
  .object({ fromStep: atelierTaskTypeSchema.optional() })
  .strict();

/** Body of POST /api/atelier/applications/:id/stage (the contract's, strict). */
export const moveRequestSchema = z
  .object({
    stage: applicationStageSchema,
    archiveReason: archiveReasonSchema.optional(),
  })
  .strict()
  .refine((v) => v.stage !== "archived" || v.archiveReason !== undefined, {
    message: "an archived card needs a reason",
  });
