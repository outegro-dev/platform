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

/**
 * The passkey relying party, checked before anything is registered: the
 * origin is a bare scheme and host (HTTPS, or HTTP on localhost only) and
 * the RP ID is that host or a parent domain of it, as browsers require.
 * Browsers take no IP address as an RP ID, so local development is
 * `localhost` with `http://localhost:<port>`.
 */
export function relyingParty(rpId: string, originValue: string) {
  const url = new URL(originValue);
  if (originValue.replace(/\/$/, "") !== url.origin)
    throw new Error("WEBAUTHN_ORIGIN must be a bare origin: scheme and host");
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && url.hostname === "localhost")
  )
    throw new Error("WEBAUTHN_ORIGIN must use HTTPS outside localhost");
  if (url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`))
    throw new Error("WEBAUTHN_RP_ID must be the origin's host or its parent");
  return { rpId, origin: url.origin };
}

/** Passkeys (ID-05). Durations are policy, not settings: one value for code and tests. */
export const webauthnConfig = registerAs("webauthn", () => ({
  ...relyingParty(env().WEBAUTHN_RP_ID, env().WEBAUTHN_ORIGIN),
  rpName: "outegro.dev",
  /** How long a ceremony may take; also the WebAuthn `timeout` (W3C: 5–10 min with UV). */
  challengeTtlMs: 5 * 60_000,
  /**
   * Registering a passkey needs a sign-in on id.outegro.dev at most this
   * long ago, the same window as the admin step-up (identity-access.md).
   */
  freshSignInMs: 5 * 60_000,
  maxPerUser: 20,
}));
