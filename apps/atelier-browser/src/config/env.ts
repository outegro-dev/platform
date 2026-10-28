import {
  baseEnvSchema,
  defineEnv,
  metricsEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Every variable atelier-browser reads. */
export const env = defineEnv(
  baseEnvSchema.extend(metricsEnvSchema.shape).extend({
    /** Bearer token of atelier-backend (service to service, ≥ 32 chars). */
    ATELIER_BROWSER_TOKEN: z.string().min(32),
    /** Browser contexts at once; one context per request. */
    BROWSER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
    /** One request from the first navigation to the answer. */
    APPLY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(300_000)
      .default(120_000),
    /** How long a request waits for a free context before it is refused. */
    APPLY_QUEUE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(600_000)
      .default(240_000),
    /** false only to watch the browser while debugging locally. */
    BROWSER_HEADLESS: z.stringbool().default(true),
  }),
);
