import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

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

export const authConfig = registerAs("auth", () => ({
  jwksUrl: env().AUTH_JWKS_URL,
  issuer: env().AUTH_ISSUER,
  audience: env().AUTH_AUDIENCE,
}));

export const httpConfig = registerAs("http", () => ({
  rateLimitPerMinute: env().HTTP_RATE_LIMIT_PER_MINUTE,
}));

export const walletConfig = registerAs("wallet", () => ({
  adminMaxAmount: BigInt(env().WALLET_ADMIN_MAX_AMOUNT),
}));

export const reconciliationConfig = registerAs("reconciliation", () => ({
  intervalMs: env().RECONCILE_INTERVAL_MS,
  fullHourUtc: env().RECONCILE_FULL_HOUR_UTC,
  sampleSize: env().RECONCILE_SAMPLE_SIZE,
  /** Tests drive the worker with tick(); the loop runs only outside tests. */
  autoStart: env().NODE_ENV !== "test",
}));
