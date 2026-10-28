import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const authConfig = registerAs("auth", () => ({
  jwksUrl: env().AUTH_JWKS_URL,
  issuer: env().AUTH_ISSUER,
  audience: env().AUTH_AUDIENCE,
}));

export const identityConfig = registerAs("identity", () => ({
  url: env().AUTH_INTERNAL_URL,
  token: env().INTERNAL_API_TOKEN,
}));

export const walletConfig = registerAs("wallet", () => ({
  mode: env().WALLET_MODE,
  url: env().WALLET_URL,
  token: env().INTERNAL_API_TOKEN,
  openingBalance: env().WALLET_MEMORY_OPENING_BALANCE,
}));

export const hashConfig = registerAs("hash", () => ({
  pepper: env().DAILY_HASH_PEPPER,
}));
