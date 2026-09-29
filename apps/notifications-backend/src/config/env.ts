import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Optional settings: an empty value (`KEY=`) means "not configured". */
const unsetIfEmpty = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

/** Every variable notifications-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend({
      INTERNAL_API_TOKEN: z.string().min(32),
      /** smtp for local Mailpit, resend in production. */
      EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("smtp"),
      SMTP_URL: z.url().default("smtp://localhost:1025"),
      RESEND_API_KEY: z.string().optional(),
      EMAIL_FROM: z
        .string()
        .min(3)
        .default("Nick Lukashik <no-reply@outegro.dev>"),
      TELEGRAM_BOT_TOKEN: z.string().optional(),
      /** Public bot name for deep links, without "@". */
      TELEGRAM_BOT_USERNAME: unsetIfEmpty(
        z.string().regex(/^[A-Za-z0-9_]{5,32}$/),
      ),
      /** Public URL Telegram posts updates to; the webhook is registered at startup. */
      TELEGRAM_WEBHOOK_URL: unsetIfEmpty(z.url()),
      /** Echoed by Telegram in X-Telegram-Bot-Api-Secret-Token. */
      TELEGRAM_WEBHOOK_SECRET: unsetIfEmpty(
        z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
      ),
      PUBLIC_WEB_URL: z.url().default("https://outegro.dev"),
      /** id-web: sessions and notification settings linked from emails. */
      ACCOUNT_URL: z.url().default("https://id.outegro.dev"),
    })
    .refine((e) => e.EMAIL_PROVIDER !== "resend" || !!e.RESEND_API_KEY, {
      message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
      path: ["RESEND_API_KEY"],
    }),
);
