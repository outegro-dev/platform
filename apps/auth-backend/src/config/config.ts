import { registerAs } from "@nestjs/config";
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
