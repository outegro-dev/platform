import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  metricsEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** "https://a.test,https://b.test" → exact origins (scheme, host, port; no path). */
const originList = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .refine(
    (origins) =>
      origins.length > 0 &&
      origins.every((origin) => {
        try {
          return new URL(origin).origin === origin;
        } catch {
          return false;
        }
      }),
    {
      message:
        "expected comma-separated origins like https://roulette.outegro.dev",
    },
  );

const chips = (fallback: number) =>
  z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(fallback);

/** Every variable roulette-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
      /** Browser origins allowed to open the game socket (roulette-web). */
      WS_ALLOWED_ORIGINS: originList,
      /** Requests per minute per client address on the HTTP API. */
      HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(240),
      /** fair-roll-backend inside the cluster. */
      FAIR_ROLL_URL: z.url(),
      INTERNAL_API_TOKEN: z.string().min(32),
      /** Only the in-memory wallet exists until wallet-backend has its internal API. */
      WALLET_MODE: z.enum(["memory"]).default("memory"),
      /** Free chips a new player starts with (owner, 28.10.2026). */
      ROULETTE_STARTER_CHIPS: chips(1000),
      ROULETTE_MIN_BET: chips(10),
      ROULETTE_MAX_BET: chips(100_000),
      ROULETTE_BETS_PER_ROUND: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(3),
      ROULETTE_PAYOUT_LIMIT_PER_COLOR: chips(1_000_000),
    }),
);
