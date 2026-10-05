import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

/** Valkey is shared by the platform: every key of this service starts with the prefix. */
export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
  keyPrefix: "edu:",
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

/** The reading assistant and its model provider; never logged (the key). */
export const assistConfig = registerAs("assist", () => ({
  enabled: env().ASSIST_ENABLED,
  apiKey: env().MINIMAX_API_KEY,
  baseUrl: env().ASSIST_BASE_URL.replace(/\/+$/, ""),
  model: env().ASSIST_MODEL,
  dailyLimit: env().ASSIST_DAILY_LIMIT,
  globalDailyLimit: env().ASSIST_GLOBAL_DAILY_LIMIT,
  maxTokens: env().ASSIST_MAX_TOKENS,
  timeoutMs: env().ASSIST_TIMEOUT_MS,
  concurrency: env().ASSIST_CONCURRENCY,
}));
export type AssistConfig = ReturnType<typeof assistConfig>;
