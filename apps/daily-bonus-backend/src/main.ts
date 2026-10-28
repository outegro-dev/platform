import "reflect-metadata";
import { existsSync } from "node:fs";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { bootstrapService } = await import("@outegro/nest-common");
const { AppModule } = await import("./app.module.js");
const { env } = await import("./config/env.js");

// Behind the roulette-web BFF (players) and the admin-web BFF (operators).
await bootstrapService(AppModule, { port: env().PORT });
