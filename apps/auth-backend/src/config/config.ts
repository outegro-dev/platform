import { registerAs } from "@nestjs/config";
import { z } from "zod";
import { env } from "./env.js";

export const appConfig = registerAs("app", () => ({
  env: env().NODE_ENV,
  port: env().PORT,
  logLevel: env().LOG_LEVEL,
}));

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
}));

export const rabbitConfig = registerAs("rabbit", () => ({
  url: env().RABBITMQ_URL,
}));

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const tokenConfig = registerAs("tokens", () => ({
  issuer: env().AUTH_ISSUER,
  audience: env().AUTH_AUDIENCE,
  privateKeyPem: env().JWT_PRIVATE_KEY,
  previousPublicKeys: env().JWT_PREVIOUS_PUBLIC_KEYS,
  accessTtlSec: env().ACCESS_TTL_SEC,
  refreshTtlSec: env().REFRESH_TTL_SEC,
  refreshGraceMs: env().REFRESH_GRACE_MS,
}));

export const loginConfig = registerAs("login", () => ({
  pepper: env().LOGIN_CODE_PEPPER,
  codeTtlSec: env().LOGIN_CODE_TTL_SEC,
  maxAttempts: 5,
  resendCooldownMs: 60_000,
}));

export const internalConfig = registerAs("internal", () => ({
  notificationsUrl: env().NOTIFICATIONS_INTERNAL_URL,
  token: env().INTERNAL_API_TOKEN,
}));

const clientSchema = z
  .array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
      name: z.string().min(1),
      redirectUris: z
        .array(
          z.url().refine((uri) => !uri.includes("*") && !new URL(uri).hash, {
            message: "exact redirect URI without wildcards or fragments",
          }),
        )
        .min(1),
    }),
  )
  .max(50);

export const oauthConfig = registerAs("oauth", () => ({
  clients: clientSchema.parse(JSON.parse(env().OAUTH_CLIENTS)),
  codeTtlMs: 60_000,
}));

/** Sign-in with Google (ID-02); disabled unless all three are set. */
export const googleConfig = registerAs("google", () => ({
  clientId: env().GOOGLE_CLIENT_ID,
  clientSecret: env().GOOGLE_CLIENT_SECRET,
  redirectUri: env().GOOGLE_REDIRECT_URI,
}));
