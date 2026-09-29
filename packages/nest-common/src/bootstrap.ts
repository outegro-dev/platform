import type { IncomingMessage, ServerResponse } from "node:http";
import { StandardSchemaValidationPipe, type Type } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { runWithCorrelation } from "@outegro/db";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { ErrorFilter, validationExceptionFactory } from "./errors.js";
import { requestIdOf } from "./logging.js";
import { HttpMetrics } from "./metrics.js";

/**
 * The rest of the request runs as its own correlation: log lines carry the
 * request id, and events it writes get it as correlation and causation id.
 */
function correlateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const requestId = requestIdOf(req, res);
  runWithCorrelation(
    { correlationId: requestId, causationId: requestId },
    next,
  );
}

/**
 * Shared HTTP setup: also used by integration tests via `configureApp`.
 * Needs MetricsModule: every request is timed by its route template.
 */
export function configureApp(
  app: NestExpressApplication,
  options: { excludeFromPrefix?: string[] } = {},
) {
  app.use(helmet());
  app.use(correlateRequest);
  app.use(app.get(HttpMetrics).middleware);
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
