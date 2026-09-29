import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

/** Valkey is shared by the platform: every key of this service starts with the prefix. */
export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
  keyPrefix: "battleship:",
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

export const realtimeConfig = registerAs("realtime", () => ({
  allowedOrigins: env().WS_ALLOWED_ORIGINS,
}));

export const httpConfig = registerAs("http", () => ({
  rateLimitPerMinute: env().HTTP_RATE_LIMIT_PER_MINUTE,
}));
