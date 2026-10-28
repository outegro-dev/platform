import "reflect-metadata";
import { existsSync } from "node:fs";
import type { NestExpressApplication } from "@nestjs/platform-express";

// Local development reads .env; in Kubernetes variables come from the pod spec.
if (existsSync(".env")) process.loadEnvFile(".env");

const { NestFactory } = await import("@nestjs/core");
const { Logger } = await import("nestjs-pino");
const { AppModule } = await import("./app.module.js");
const { setupApp } = await import("./app.setup.js");
const { env } = await import("./config/env.js");

// bootstrapService of @outegro/nest-common plus a JSON limit that fits a CV:
// the parser has to be registered before configureApp and listen.
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
setupApp(app);
await app.listen(env().PORT, "0.0.0.0");
