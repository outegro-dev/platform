import { registerAs } from "@nestjs/config";
import type { AtelierTaskType } from "@outegro/contracts/atelier";
import { env, storageDriver } from "./env.js";

export const dbConfig = registerAs("db", () => ({
  url: env().DATABASE_URL ?? "",
  max: env().DATABASE_POOL_MAX,
}));

/** Valkey is shared by the platform: every key of this service starts with the prefix. */
export const valkeyConfig = registerAs("valkey", () => ({
  url: env().VALKEY_URL,
  keyPrefix: "atelier:",
}));

export const rabbitConfig = registerAs("rabbit", () => ({
  url: env().RABBITMQ_URL,
}));

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const authConfig = registerAs("auth", () => ({
  jwksUrl: env().AUTH_JWKS_URL,
  devJwksFile: env().DEV_AUTH_JWKS_FILE,
  issuer: env().AUTH_ISSUER ?? "",
  audience: env().AUTH_AUDIENCE ?? "",
}));

export const httpConfig = registerAs("http", () => ({
  rateLimitPerMinute: env().HTTP_RATE_LIMIT_PER_MINUTE,
}));

/** The pipeline: retries, pauses and the scheduler. */
export const pipelineConfig = registerAs("pipeline", () => ({
  maxAttempts: env().STEP_MAX_ATTEMPTS,
  quotaPauseSeconds: env().LLM_QUOTA_PAUSE_SECONDS,
  schedulerIntervalMs: env().SCHEDULER_INTERVAL_MS,
  tickDailyHour: env().TICK_DAILY_HOUR,
}));
export type PipelineConfig = ReturnType<typeof pipelineConfig>;

export const cvLinksConfig = registerAs("cvLinks", () => ({
  publicBaseUrl: env().CV_PUBLIC_BASE_URL.replace(/\/+$/, ""),
  ownerCookieSecret: env().CV_OWNER_COOKIE_SECRET,
  ownerCookieDomain: env().CV_OWNER_COOKIE_DOMAIN,
}));
export type CvLinksConfig = ReturnType<typeof cvLinksConfig>;

export const storageConfig = registerAs("storage", () => ({
  driver: storageDriver(),
  endpoint: env().S3_ENDPOINT,
  bucket: env().S3_BUCKET,
  accessKeyId: env().S3_ACCESS_KEY_ID,
  secretAccessKey: env().S3_SECRET_ACCESS_KEY,
  region: env().S3_REGION,
  forcePathStyle: env().S3_FORCE_PATH_STYLE,
}));
export type StorageConfig = ReturnType<typeof storageConfig>;

/** The HTTP services a worker calls; tokens are never logged. */
export const servicesConfig = registerAs("services", () => ({
  llm: {
    url: env().LLM_GATEWAY_URL.replace(/\/+$/, ""),
    token: env().LLM_GATEWAY_TOKEN ?? "",
    timeoutMs: env().LLM_TIMEOUT_MS,
    defaultProfile: env().LLM_PROFILE_DEFAULT,
  },
  tex: {
    url: env().ATELIER_TEX_URL.replace(/\/+$/, ""),
    token: env().ATELIER_TEX_TOKEN ?? "",
  },
  browser: {
    url: env().ATELIER_BROWSER_URL.replace(/\/+$/, ""),
    token: env().ATELIER_BROWSER_TOKEN ?? "",
  },
}));
export type ServicesConfig = ReturnType<typeof servicesConfig>;

/**
 * Model profile of a step: LLM_PROFILE_<STEP> (ATS_CHECK for ats-check),
 * else LLM_PROFILE_DEFAULT. Read on every call, so a pod restart is enough.
 */
export function llmProfileFor(
  step: AtelierTaskType,
  source: NodeJS.ProcessEnv = process.env,
  fallback = env().LLM_PROFILE_DEFAULT,
) {
  const key = `LLM_PROFILE_${step.toUpperCase().replace(/-/g, "_")}`;
  return source[key]?.trim() || fallback;
}

export const workerConfig = registerAs("worker", () => ({
  tasks: env()
    .WORKER_TASKS?.split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  concurrency: env().WORKER_CONCURRENCY,
}));
export type WorkerConfig = ReturnType<typeof workerConfig>;
