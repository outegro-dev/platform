import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

/**
 * Production gives roulette a Valkey of its own (ADR-012); locally it shares
 * the platform one, so every key still starts with the prefix.
 */
export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
  keyPrefix: "roulette:",
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

export const fairRollConfig = registerAs("fairRoll", () => ({
  url: env().FAIR_ROLL_URL,
  token: env().INTERNAL_API_TOKEN,
}));

export const walletConfig = registerAs("wallet", () => ({
  mode: env().WALLET_MODE,
  url: env().WALLET_URL,
  token: env().INTERNAL_API_TOKEN,
  openingBalance: env().WALLET_MEMORY_OPENING_BALANCE,
}));

/** Table limits; the multipliers are not settings (ADR-012). */
export const tableConfig = registerAs("table", () => ({
  minBet: env().ROULETTE_MIN_BET,
  maxBet: env().ROULETTE_MAX_BET,
  betsPerRound: env().ROULETTE_BETS_PER_ROUND,
  payoutLimitPerColor: env().ROULETTE_PAYOUT_LIMIT_PER_COLOR,
}));
