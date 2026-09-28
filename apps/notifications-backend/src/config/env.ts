import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

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
      PUBLIC_WEB_URL: z.url().default("https://outegro.dev"),
    })
    .refine((e) => e.EMAIL_PROVIDER !== "resend" || !!e.RESEND_API_KEY, {
      message: "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
      path: ["RESEND_API_KEY"],
    }),
);
