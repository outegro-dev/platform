import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureApp } from "@outegro/nest-common";
import { LlmErrorFilter } from "./gateway/llm-error.filter.js";

/** A generation request carries a whole vacancy and profile (input up to 600 000 characters). */
export const BODY_LIMIT = "8mb";

/**
 * The platform HTTP setup (configureApp) with a larger JSON body limit and
 * generation errors in the LlmError shape; used by main.ts and the tests.
 * The parser is registered first, so Nest skips its own 100 kB one.
 */
export function setupApp(app: NestExpressApplication) {
  app.useBodyParser("json", { limit: BODY_LIMIT });
  configureApp(app);
  // Registered last, so it is asked first; it hands non-generation errors to ErrorFilter.
  app.useGlobalFilters(new LlmErrorFilter());
  return app;
}
