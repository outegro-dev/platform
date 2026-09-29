import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Comma-separated list, blanks dropped: "a, b," → ["a", "b"]. */
const list = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

/** Optional secret: an empty `KEY=` line in .env means "not configured". */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value ? value : undefined));

/** Every variable payments-backend reads. Nothing else touches process.env. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend({
      /** Sales stay closed until the owner opens them (checkpoint 6). */
      CHECKOUT_ENABLED: z.stringbool().default(false),
      /** pay-web: where buyers come back after the Lava page. */
      PAY_WEB_URL: z.url().default("https://pay.outegro.dev"),
      /** Origins a client may pass as `returnUrl`; PAY_WEB_URL is always allowed. */
      CHECKOUT_RETURN_ORIGINS: list,
      LAVA_API_URL: z.url().default("https://gate.lava.top"),
      /** Outgoing API key (lava.top cabinet). Without it checkout is unavailable. */
      LAVA_API_KEY: optionalSecret,
      /** Incoming webhook credential: Lava sends it in the X-Api-Key header. */
      LAVA_WEBHOOK_SECRET: z.string().min(32),
      LAVA_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(60_000)
        .default(10_000),
      /** Optional allowlist for payment page hosts; empty accepts any https URL. */
      LAVA_PAYMENT_URL_HOSTS: list,
      RECONCILE_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(5_000)
        .max(3_600_000)
        .default(60_000),
      EXPIRY_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(5_000)
        .max(3_600_000)
        .default(60_000),
    }),
);
