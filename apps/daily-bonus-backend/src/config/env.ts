import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  metricsEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Every variable daily-bonus-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
      /** Identity's internal API: verified email, account age, current access. */
      AUTH_INTERNAL_URL: z.url(),
      INTERNAL_API_TOKEN: z.string().min(32),
      /** Client addresses and device ids are stored only as peppered hashes. */
      DAILY_HASH_PEPPER: z.string().min(32),
      /**
       * Prizes go to wallet-backend's internal API (`http`); `memory` is a
       * stand-in for local runs and never runs in production.
       */
      WALLET_MODE: z.enum(["memory", "http"]).default("memory"),
      WALLET_URL: z.url().optional(),
      WALLET_MEMORY_OPENING_BALANCE: z.coerce.number().int().min(0).default(0),
    })
    .refine(
      (env) => env.WALLET_MODE === "http" || env.NODE_ENV !== "production",
      {
        message: "production credits real grumbles: WALLET_MODE must be http",
        path: ["WALLET_MODE"],
      },
    )
    .refine((env) => env.WALLET_MODE !== "http" || env.WALLET_URL, {
      message: "WALLET_MODE=http needs WALLET_URL",
      path: ["WALLET_URL"],
    }),
);
