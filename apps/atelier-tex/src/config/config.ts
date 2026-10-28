import { tmpdir } from "node:os";
import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

export const texConfig = registerAs("tex", () => ({
  concurrency: env().TEX_CONCURRENCY,
  queueMax: env().TEX_QUEUE_MAX,
  timeoutMs: env().TEX_TIMEOUT_MS,
  workDir: env().TEX_WORK_DIR ?? tmpdir(),
}));
export type TexConfig = ReturnType<typeof texConfig>;
