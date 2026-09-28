import {
  baseEnvSchema,
  databaseEnvSchema,
  defineEnv,
  rabbitEnvSchema,
  valkeyEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

const secret = (min: number) => z.string().min(min);

/** Every variable auth-backend reads. Nothing else touches process.env. */
export const env = defineEnv(
  baseEnvSchema
    .extend(databaseEnvSchema.shape)
    .extend(valkeyEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend({
      AUTH_ISSUER: z.url().default("https://id.outegro.dev"),
      AUTH_AUDIENCE: z.string().min(1).default("outegro"),
      /** ES256 private key, PKCS#8 PEM (local: `pnpm env:local` at the repo root). */
      JWT_PRIVATE_KEY: secret(100),
      /** Retired public keys (JSON array of JWK) still published during rotation. */
      JWT_PREVIOUS_PUBLIC_KEYS: z.string().default("[]"),
      ACCESS_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(300),
      REFRESH_TTL_SEC: z.coerce
        .number()
        .int()
        .min(3600)
        .default(30 * 24 * 3600),
      /** Window in which the previous refresh token may repeat a rotation (ADR-004). */
      REFRESH_GRACE_MS: z.coerce
        .number()
        .int()
        .min(1000)
        .max(60_000)
        .default(20_000),
      LOGIN_CODE_PEPPER: secret(32),
      LOGIN_CODE_TTL_SEC: z.coerce
        .number()
        .int()
        .min(60)
        .max(1800)
        .default(600),
      NOTIFICATIONS_INTERNAL_URL: z.url(),
      INTERNAL_API_TOKEN: secret(32),
      /**
       * Registered SSO clients: JSON array of { id, name, redirectUris }.
       * Redirect URIs match exactly; no wildcards (ID-04).
       */
      OAUTH_CLIENTS: z.string().default("[]"),
    }),
);
