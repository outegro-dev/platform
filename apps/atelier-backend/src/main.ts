import "reflect-metadata";
import { existsSync } from "node:fs";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { bootstrapService } = await import("@outegro/nest-common");
const { AppModule } = await import("./app.module.js");
const { env } = await import("./config/env.js");
const { cvLinkPaths } = await import("./cv-links/cv-links.controller.js");

// A dynamic module: the roles decide what is imported.
await bootstrapService(AppModule.forRoles(env().ROLE) as never, {
  port: env().PORT,
  excludeFromPrefix: cvLinkPaths,
});
