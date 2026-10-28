import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

/** The Chromium pool and the limits of one apply request. */
export const browserConfig = registerAs("browser", () => ({
  concurrency: env().BROWSER_CONCURRENCY,
  timeoutMs: env().APPLY_TIMEOUT_MS,
  queueTimeoutMs: env().APPLY_QUEUE_TIMEOUT_MS,
  headless: env().BROWSER_HEADLESS,
}));
export type BrowserConfig = ReturnType<typeof browserConfig>;
