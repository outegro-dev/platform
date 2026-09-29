import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  jwksEnvSchema,
  rabbitEnvSchema,
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
        "expected comma-separated origins like https://battleship.outegro.dev",
    },
  );

/** Every variable battleship-backend reads. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(jwksEnvSchema.shape)
    .extend({
      /** Browser origins allowed to open the game socket (battleship-web). */
      WS_ALLOWED_ORIGINS: originList,
      /** Requests per minute per client address on the HTTP API. */
      HTTP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(240),
    }),
);
