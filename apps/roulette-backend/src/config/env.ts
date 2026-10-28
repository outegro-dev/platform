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

const grumbles = (fallback: number) =>
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
      /** Identity's internal API: who an admin is right now. */
      AUTH_INTERNAL_URL: z.url(),
      /** daily-bonus-backend, for the admin console's service health. */
      DAILY_BONUS_URL: z.url().optional(),
      INTERNAL_API_TOKEN: z.string().min(32),
      /**
       * The grumbles wallet: wallet-backend's internal API (`http`), or the
       * in-memory stand-in for local runs (`memory`, never in production).
       */
      WALLET_MODE: z.enum(["memory", "http"]).default("memory"),
      WALLET_URL: z.url().optional(),
      /** What a player the in-memory wallet has not seen starts with. */
      WALLET_MEMORY_OPENING_BALANCE: z.coerce
        .number()
        .int()
        .min(0)
        .default(1000),
      /** Table limits (owner, 28.10.2026). */
      ROULETTE_MIN_BET: grumbles(10),
      ROULETTE_MAX_BET: grumbles(100_000),
      ROULETTE_BETS_PER_ROUND: z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .default(3),
      ROULETTE_PAYOUT_LIMIT_PER_COLOR: grumbles(1_000_000),
    })
    .refine(
      (env) => env.WALLET_MODE === "http" || env.NODE_ENV !== "production",
      {
        message: "production stakes real grumbles: WALLET_MODE must be http",
        path: ["WALLET_MODE"],
      },
    )
    .refine((env) => env.WALLET_MODE !== "http" || env.WALLET_URL, {
      message: "WALLET_MODE=http needs WALLET_URL",
      path: ["WALLET_URL"],
    }),
);
