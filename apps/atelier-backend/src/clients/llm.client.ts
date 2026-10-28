import {
  type AtelierTaskType,
  type LlmGenerateRequest,
  llmErrorSchema,
  llmGenerateResponseSchema,
} from "@outegro/contracts/atelier";
import { z } from "zod";
import { llmProfileFor, type ServicesConfig } from "../config/config.js";
import {
  type LlmPort,
  type LlmPrompt,
  PortError,
  type UsageMeter,
} from "../steps/step-handler.js";
import { postJson } from "./http.js";

/** The prompt's answer schema as JSON Schema (engine prompts may hand Zod). */
export function jsonSchemaOf(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === "object" && "_zod" in schema)
    return z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>;
  if (schema && typeof schema === "object")
    return schema as Record<string, unknown>;
  throw new Error("prompt schema must be a JSON Schema object");
}

/**
 * llm-gateway for one task: the step's model profile (LLM_PROFILE_<STEP>),
 * request ids from the task's idempotency key (a redelivered task asks the
 * same questions), usage summed into the task's meter. A quota answer
 * becomes a PortError with `resetsAt`: the orchestrator pauses the step.
 */
export function llmPort(
  config: ServicesConfig["llm"],
  step: AtelierTaskType,
  requestKey: string,
  usage: UsageMeter,
): LlmPort {
  let call = 0;
  return {
    async generate<T>(prompt: LlmPrompt<T>, options: { key?: string } = {}) {
      call++;
      const request: LlmGenerateRequest = {
        profile: llmProfileFor(step, process.env, config.defaultProfile),
        purpose: prompt.purpose.slice(0, 80),
        system: prompt.system,
        input: prompt.input,
        schema: jsonSchemaOf(prompt.schema),
        requestId: `${requestKey}:${options.key ?? call}`.slice(0, 200),
        timeoutMs: config.timeoutMs,
      };
      usage.llmCalls++;
      const raw = await postJson(`${config.url}/v1/generate`, {
        token: config.token,
        body: request,
        timeoutMs: config.timeoutMs + 30_000,
        service: "llm",
        requestId: request.requestId,
        onError: (status, body) => {
          const parsed = llmErrorSchema.safeParse(body);
          if (!parsed.success) return undefined;
          const error = parsed.data;
          throw new PortError(
            error.error,
            `llm-gateway ${status}: ${error.message}`,
            error.retryable || error.error === "provider_quota",
            error.resetsAt,
          );
        },
      });
      const response = llmGenerateResponseSchema.safeParse(raw);
      if (!response.success)
        throw new PortError(
          "llm_unavailable",
          "llm-gateway answered an unknown shape",
          true,
        );
      usage.tokensIn += response.data.usage.input ?? 0;
      usage.tokensOut += response.data.usage.output ?? 0;
      try {
        return prompt.parse(response.data.output);
      } catch (error) {
        // The model answered, but not usably: another attempt may do better.
        throw new PortError(
          "invalid_output",
          `${prompt.purpose}: ${(error as Error).message}`.slice(0, 2000),
          true,
        );
      }
    },
  };
}
