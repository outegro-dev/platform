import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { LoggerModule } from "nestjs-pino";

const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Structured JSON logs to stdout (Alloy → Loki). Every line inside a request
 * carries its request id; secrets and codes are redacted; health probes are
 * not access-logged.
 */
export function createLoggerModule(options: {
  service: string;
  level: string;
  pretty?: boolean;
}) {
  return LoggerModule.forRoot({
    pinoHttp: {
      name: options.service,
      level: options.level,
      messageKey: "message",
      base: { service: options.service },
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers["x-request-id"];
        const id =
          typeof incoming === "string" && REQUEST_ID.test(incoming)
            ? incoming
            : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
      customProps: (req: IncomingMessage) => ({
        requestId: (req as { id?: string }).id,
      }),
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
    },
  });
}
