import { StandardSchemaValidationPipe, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { ErrorFilter, validationExceptionFactory } from "./errors.js";

/** Shared HTTP setup: also used by integration tests via `configureApp`. */
export function configureApp(
  app: NestExpressApplication,
  options: { excludeFromPrefix?: string[] } = {},
) {
  app.use(helmet());
  // One Traefik hop in front of every service.
  app.set("trust proxy", 1);
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  app.setGlobalPrefix("v1", {
    exclude: ["health", "health/deep", ...(options.excludeFromPrefix ?? [])],
  });
  app.enableShutdownHooks();
  return app;
}

/**
 * Starts a platform service: pino logger, helmet, Zod validation through
 * Standard Schema, contract error bodies, `/v1` prefix, graceful shutdown.
 */
export async function bootstrapService(
  module: Type,
  options: { port: number; excludeFromPrefix?: string[] },
) {
  const app = await NestFactory.create<NestExpressApplication>(module, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  configureApp(app, options);
  await app.listen(options.port, "0.0.0.0");
  return app;
}
