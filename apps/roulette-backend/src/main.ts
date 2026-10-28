import "reflect-metadata";
import { existsSync } from "node:fs";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { bootstrapService } = await import("@outegro/nest-common");
const { AppModule } = await import("./app.module.js");
const { env } = await import("./config/env.js");

// The game socket (/ws) shares this port; the Ingress routes /ws here directly.
await bootstrapService(AppModule, { port: env().PORT });
