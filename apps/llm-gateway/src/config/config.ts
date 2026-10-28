import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { registerAs } from "@nestjs/config";
import { env } from "./env.js";

/** config/llm-profiles.json next to src/ and dist/. */
export const defaultProfilesPath = fileURLToPath(
  new URL("../../config/llm-profiles.json", import.meta.url),
);

export const metricsConfig = registerAs("metrics", () => ({
  port: env().METRICS_PORT,
}));

/** The gateway itself; the token is never logged. */
export const gatewayConfig = registerAs("gateway", () => ({
  token: env().LLM_GATEWAY_TOKEN,
  profilesPath: env().LLM_PROFILES_PATH ?? defaultProfilesPath,
  quotaPauseSeconds: env().LLM_QUOTA_PAUSE_SECONDS,
  queueTimeoutMs: env().LLM_QUEUE_TIMEOUT_MS,
  account: env().LLM_ACCOUNT,
}));
export type GatewayConfig = ReturnType<typeof gatewayConfig>;

/** Provider credentials; never logged. */
export const providersConfig = registerAs("providers", () => ({
  codexHome: env().CODEX_HOME ?? join(homedir(), ".codex"),
  claudeOauthToken: env().CLAUDE_CODE_OAUTH_TOKEN,
  minimaxApiKey: env().MINIMAX_API_KEY,
}));
export type ProvidersConfig = ReturnType<typeof providersConfig>;
