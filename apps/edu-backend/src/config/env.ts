import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  metricsEnvSchema,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Optional secret: an empty `KEY=` line in .env means "not configured". */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/** Every variable edu-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
      /** Requests per minute per client address on the HTTP API. */
      HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(240),
      /**
       * The reading assistant (ADR-010). On only with a provider key and
       * outside SAFE_MODE: it is a paid call to an external provider.
       */
      ASSIST_ENABLED: z.stringbool().default(false),
      /** MiniMax API key (Anthropic-compatible Messages API). */
      MINIMAX_API_KEY: optionalSecret,
      ASSIST_BASE_URL: z.url().default("https://api.minimax.io/anthropic"),
      ASSIST_MODEL: z.string().trim().min(1).max(100).default("MiniMax-M3"),
      /** Answers from the model (not from the cache) per reader per UTC day. */
      ASSIST_DAILY_LIMIT: z.coerce.number().int().min(0).max(1000).default(30),
      /**
       * Requests to the model per UTC day across all readers: a cap on the
       * provider bill, 0 for none. Once reached, the assistant pauses until
       * the next day; cached answers are still served.
       */
      ASSIST_GLOBAL_DAILY_LIMIT: z.coerce
        .number()
        .int()
        .min(0)
        .max(100_000)
        .default(500),
      ASSIST_MAX_TOKENS: z.coerce
        .number()
        .int()
        .min(256)
        .max(16_000)
        .default(1800),
      /** One call to the model, the whole streamed answer included. */
      ASSIST_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(5_000)
        .max(300_000)
        .default(90_000),
      /** Calls to the model at once in this pod; the next ones wait for a slot. */
      ASSIST_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(3),
    }),
);
