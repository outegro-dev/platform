import "reflect-metadata";
import { existsSync } from "node:fs";
import type { NestExpressApplication } from "@nestjs/platform-express";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { NestFactory } = await import("@nestjs/core");
const { Logger } = await import("nestjs-pino");
const { AppModule } = await import("./app.module.js");
const { setupApp } = await import("./app.js");
const { env } = await import("./config/env.js");

// bootstrapService of nest-common, plus the larger body limit of setupApp.
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
setupApp(app);
await app.listen(env().PORT, "0.0.0.0");
