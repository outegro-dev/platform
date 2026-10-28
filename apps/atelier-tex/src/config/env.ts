import {
  baseEnvSchema,
  defineEnv,
  metricsEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Every variable atelier-tex reads. */
export const env = defineEnv(
  baseEnvSchema.extend(metricsEnvSchema.shape).extend({
    /** Bearer token of atelier-backend; the guard refuses one under 32 chars. */
    ATELIER_TEX_TOKEN: z.string().trim().min(32),
    /** XeLaTeX compiles at once in this pod; the next renders wait for a slot. */
    TEX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
    /** Renders waiting for a slot; one more is refused with 429. */
    TEX_QUEUE_MAX: z.coerce.number().int().min(0).max(200).default(16),
    /** One xelatex run (a render runs it twice) or one poppler call. */
    TEX_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(5_000)
      .max(300_000)
      .default(60_000),
    /** Parent of the per-render temporary folders; the OS temp dir by default. */
    TEX_WORK_DIR: z.string().trim().min(1).optional(),
  }),
);
