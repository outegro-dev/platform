import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureApp } from "@outegro/nest-common";

/** A CV travels as base64 inside the JSON body; Express's default is 100 kB. */
export const BODY_LIMIT = "25mb";

/** Platform HTTP setup plus the larger JSON limit; used by main.ts and tests. */
export function setupApp(app: NestExpressApplication) {
  app.useBodyParser("json", { limit: BODY_LIMIT });
  return configureApp(app);
}
