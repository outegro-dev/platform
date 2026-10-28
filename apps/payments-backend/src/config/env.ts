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

/** A price as the Lava offer has it: "99", "0.59". */
const decimal = z.string().regex(/^\d{1,13}(\.\d{1,2})?$/);

/** One pack of grumbles (GRUMBLE-PACKS): its own Lava offer and prices. */
const packSchema = z
  .object({
    key: z.string().regex(/^grumbles-[a-z0-9-]{1,40}$/),
    grumbles: z.number().int().min(1).max(1_000_000_000),
    offerId: z.uuid(),
    prices: z
      .object({
        RUB: decimal.optional(),
        USD: decimal.optional(),
        EUR: decimal.optional(),
      })
      .strict()
      .refine((prices) => Object.keys(prices).length > 0, {
        message: "a pack needs a price",
      }),
  })
  .strict();

/** JSON in an environment variable; malformed text is a startup error. */
const packsJson = z
  .string()
  .default("[]")
  .transform((text, ctx) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "not JSON" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(packSchema)
      .max(20)
      .refine(
        (packs) =>
          new Set(packs.map((p) => p.key)).size === packs.length &&
          new Set(packs.map((p) => p.offerId)).size === packs.length,
        { message: "pack keys and offers must be unique" },
      ),
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
    .extend(metricsEnvSchema.shape)
    .extend({
      /** Sales stay closed until the owner opens them (checkpoint 6). */
      CHECKOUT_ENABLED: z.stringbool().default(false),
      /**
       * Packs of grumbles (phase 2) stay out of the catalog until the owner
       * opens them; GRUMBLE_PACKS is JSON
       * `[{ "key", "grumbles", "offerId", "prices" }]`, one Lava offer each.
       */
      GRUMBLE_PACKS_ENABLED: z.stringbool().default(false),
      GRUMBLE_PACKS: packsJson,
      /**
       * auth-backend's internal API, for buyers whose Identity events predate
       * this service. Both unset: such buyers wait for events.
       */
      AUTH_INTERNAL_URL: z
        .string()
        .optional()
        .transform((value) => (value ? value : undefined))
        .pipe(z.url().optional()),
      INTERNAL_API_TOKEN: optionalSecret.pipe(z.string().min(32).optional()),
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
