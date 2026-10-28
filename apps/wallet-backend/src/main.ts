import "reflect-metadata";
import { existsSync } from "node:fs";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { bootstrapService } = await import("@outegro/nest-common");
const { AppModule } = await import("./app.module.js");
const { env } = await import("./config/env.js");
const { JSON_LIMIT } = await import("./internal/internal.controller.js");

// A credit batch carries up to 1 000 payouts, each with up to 2 KB of meta.
await bootstrapService(AppModule, { port: env().PORT, jsonLimit: JSON_LIMIT });
