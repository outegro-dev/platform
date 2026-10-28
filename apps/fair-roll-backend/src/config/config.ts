import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL,
  max: env().DATABASE_POOL_MAX,
}));

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const chainConfig = registerAs("chain", () => ({
  root: env().FAIR_ROLL_ROOT,
  length: env().FAIR_ROLL_CHAIN_LENGTH,
  publicSeed: env().FAIR_ROLL_PUBLIC_SEED,
}));
