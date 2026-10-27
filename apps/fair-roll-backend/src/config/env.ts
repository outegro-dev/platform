import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  metricsEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Every variable fair-roll-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
      /** Shared service token: roulette-backend is the only caller. */
      INTERNAL_API_TOKEN: z.string().min(32),
      /** The secret root of the chain; whoever holds it knows every outcome. */
      FAIR_ROLL_ROOT: z
        .string()
        .regex(/^[0-9a-f]{64}$/, "expected 64 lowercase hex characters"),
      /** Rounds in the chain: 1 000 000 is about 347 days of 30-second rounds. */
      FAIR_ROLL_CHAIN_LENGTH: z.coerce
        .number()
        .int()
        .min(1)
        .max(10_000_000)
        .default(1_000_000),
      /** Published with the commit: the value of an announced future drand round. */
      FAIR_ROLL_PUBLIC_SEED: z.string().trim().min(1).max(256),
    }),
);
