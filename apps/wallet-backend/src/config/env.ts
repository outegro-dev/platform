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

/** Every variable wallet-backend reads. Nothing else touches process.env. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
      /**
       * The shared service token of the platform: payments and
       * roulette-backend present it on the internal API.
       */
      INTERNAL_API_TOKEN: z.string().min(32),
      /** Requests per minute per client address on the player and admin API. */
      HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(240),
      /** The most one admin command may grant or take (engineering default). */
      WALLET_ADMIN_MAX_AMOUNT: z.coerce
        .number()
        .int()
        .min(1)
        .max(999_999_999_999_999)
        .default(1_000_000),
      /** Sample reconciliation passes. */
      RECONCILE_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(5_000)
        .max(3_600_000)
        .default(300_000),
      /** The full pass runs once a day, on the first pass after this UTC hour. */
      RECONCILE_FULL_HOUR_UTC: z.coerce
        .number()
        .int()
        .min(0)
        .max(23)
        .default(2),
      /** Random wallets a sample pass checks besides the ones that changed. */
      RECONCILE_SAMPLE_SIZE: z.coerce
        .number()
        .int()
        .min(0)
        .max(10_000)
        .default(100),
    }),
);
