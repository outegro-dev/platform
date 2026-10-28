import {
  baseEnvSchema,
  defineEnv,
  metricsEnvSchema,
} from "@outegro/nest-common";
import { z } from "zod";

/** Optional secret: an empty `KEY=` line in .env means "not configured". */
const optionalSecret = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

/** Every variable llm-gateway reads. */
export const env = defineEnv(
  baseEnvSchema.extend(metricsEnvSchema.shape).extend({
    /** Bearer token of the callers (atelier workers); at least 32 characters. */
    LLM_GATEWAY_TOKEN: z.string().trim().min(32),
    /** Profiles and provider settings; default: config/llm-profiles.json of this app. */
    LLM_PROFILES_PATH: optionalText,
    /** Pause after a limit whose reset time the provider did not name. */
    LLM_QUOTA_PAUSE_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(43_200)
      .default(3600),
    /** Longest wait for a free provider slot before 503. */
    LLM_QUEUE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .max(3_600_000)
      .default(900_000),
    /** The one logged-in account (`account` of a request); more come with SaaS. */
    LLM_ACCOUNT: z.string().trim().min(1).max(80).default("owner"),
    /** Codex login (auth.json) and state; Codex's own default is ~/.codex. */
    CODEX_HOME: optionalText,
    /** Claude Code subscription token (`claude setup-token`). */
    CLAUDE_CODE_OAUTH_TOKEN: optionalSecret,
    /** MiniMax API key; without it the MiniMax profiles are unavailable. */
    MINIMAX_API_KEY: optionalSecret,
  }),
);
export type GatewayEnv = ReturnType<typeof env>;
