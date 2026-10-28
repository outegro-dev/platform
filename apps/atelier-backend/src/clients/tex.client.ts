import {
  type BrowserApplyRequest,
  browserApplyResponseSchema,
  type TexRenderRequest,
  texRenderResponseSchema,
} from "@outegro/contracts/atelier";
import type { ServicesConfig } from "../config/config.js";
import {
  type BrowserPort,
  PortError,
  type TexPort,
} from "../steps/step-handler.js";
import { postJson } from "./http.js";

/** atelier-tex: one render of the CV document. */
export function texPort(config: ServicesConfig["tex"]): TexPort {
  return {
    async render(request: TexRenderRequest) {
      const raw = await postJson(`${config.url}/v1/render`, {
        token: config.token,
        body: request,
        timeoutMs: 180_000,
        service: "tex",
        onError: (status, body) => {
          // 422: the document does not compile; the log tail says why. 429
          // (busy) and 5xx fall through as retryable.
          if (status !== 422) return undefined;
          const error = (
            body as { error?: { fieldErrors?: { log?: unknown } } }
          )?.error;
          const log = error?.fieldErrors?.log;
          throw new PortError(
            "tex_compile_failed",
            `XeLaTeX failed: ${Array.isArray(log) ? log.join("\n") : String(log ?? "no log")}`.slice(
              -2000,
            ),
            false,
          );
        },
      });
      const parsed = texRenderResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new PortError(
          "tex_invalid",
          "atelier-tex answered an unknown shape",
          true,
        );
      return parsed.data;
    },
  };
}

/** atelier-browser: fill (and submit) one ATS form. */
export function browserPort(config: ServicesConfig["browser"]): BrowserPort {
  return {
    async apply(request: BrowserApplyRequest) {
      const raw = await postJson(`${config.url}/v1/apply`, {
        token: config.token,
        body: request,
        timeoutMs: 600_000,
        service: "browser",
      });
      const parsed = browserApplyResponseSchema.safeParse(raw);
      if (!parsed.success)
        throw new PortError(
          "browser_invalid",
          "atelier-browser answered an unknown shape",
          true,
        );
      return parsed.data;
    },
  };
}
