import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { currentCorrelation } from "@outegro/db";
import { LoggerModule } from "nestjs-pino";
import type { DestinationStream } from "pino";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * The request's id: a well-formed `x-request-id` from the caller (BFF or
 * another service) or a new UUID. Assigned once and echoed in the response.
 */
export function requestIdOf(req: IncomingMessage, res: ServerResponse) {
  const request = req as IncomingMessage & { id?: string };
  if (request.id) return request.id;
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  res.setHeader("x-request-id", id);
  request.id = id;
  return id;
}

/**
 * Structured JSON logs to stdout (Alloy → Loki). Every line inside a request
 * carries its request id, every line inside a request or a consumed event its
 * correlation id; secrets and codes are redacted; health probes are not
 * access-logged.
 */
export function createLoggerModule(options: {
  service: string;
  level: string;
  pretty?: boolean;
  /** Where lines go instead of stdout (tests). */
  destination?: DestinationStream;
}) {
  return LoggerModule.forRoot({
    pinoHttp: {
      name: options.service,
      level: options.level,
      messageKey: "message",
      base: { service: options.service },
      genReqId: requestIdOf,
      customProps: (req: IncomingMessage) => ({
        requestId: (req as { id?: string }).id,
      }),
      mixin: () => {
        const correlation = currentCorrelation();
        return correlation ? { correlationId: correlation.correlationId } : {};
      },
      autoLogging: {
        ignore: (req: IncomingMessage) =>
          req.url?.startsWith("/health") ?? false,
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'res.headers["set-cookie"]',
          "*.password",
          "*.code",
          "*.token",
          "*.accessToken",
          "*.refreshToken",
          "*.secret",
        ],
        censor: "[redacted]",
      },
      ...(options.pretty
        ? {
            transport: {
              target: "pino-pretty",
              options: { singleLine: true, messageKey: "message" },
            },
          }
        : {}),
      ...(options.destination ? { stream: options.destination } : {}),
    },
  });
}
