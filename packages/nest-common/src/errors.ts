import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import {
  type ErrorBody,
  type ErrorCode,
  errorCodes,
  messageKeyFor,
} from "@outegro/contracts";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { Request, Response } from "express";

/** Domain error with a stable code; never carries secrets or SQL. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    options: {
      message?: string;
      fieldErrors?: Record<string, string[]>;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? code, { cause: options.cause });
    this.fieldErrors = options.fieldErrors ?? {};
    this.retryable = options.retryable ?? code === "DEPENDENCY_UNAVAILABLE";
  }
  readonly fieldErrors: Record<string, string[]>;
  readonly retryable: boolean;
}

/** For StandardSchemaValidationPipe: issues become field errors, not a flat list. */
export function validationExceptionFactory(
  issues: readonly StandardSchemaV1.Issue[],
): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key =
      issue.path
        ?.map((segment) =>
          typeof segment === "object" ? segment.key : segment,
        )
        .join(".") || "_";
    const list = fieldErrors[key] ?? [];
    list.push(issue.message);
    fieldErrors[key] = list;
  }
  return new AppError("VALIDATION_FAILED", { fieldErrors });
}

const codeByStatus: Partial<Record<number, ErrorCode>> = {
  400: "VALIDATION_FAILED",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "VALIDATION_FAILED",
  415: "VALIDATION_FAILED",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
  503: "DEPENDENCY_UNAVAILABLE",
};

/**
 * The error body-parser refuses a body with: http-errors marks it safe to
 * show (`expose`), with a 4xx `status` and a `type` such as
 * `entity.too.large`. Nest hands it to the filter as it is; only invalid
 * JSON arrives as a BadRequestException.
 */
function refusedBody(exception: unknown) {
  const { expose, status, type } = (exception ?? {}) as {
    expose?: unknown;
    status?: unknown;
    type?: unknown;
  };
  return expose === true &&
    typeof type === "string" &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
    ? { status, type }
    : undefined;
}

/**
 * Renders every error in the HTTP contract shape:
 * `{ error: { code, messageKey, fieldErrors, requestId, retryable } }`.
 * Unknown errors become INTERNAL and are logged; details never leak.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("ErrorFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    // Health probes keep the terminus body (per-dependency status) for Kubernetes.
    if (
      exception instanceof HttpException &&
      request.path?.startsWith("/health")
    ) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    let code: ErrorCode = "INTERNAL";
    let fieldErrors: Record<string, string[]> = {};
    let retryable = false;
    const refused = refusedBody(exception);
    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : refused?.status;

    if (exception instanceof AppError) {
      code = exception.code;
      fieldErrors = exception.fieldErrors;
      retryable = exception.retryable;
    } else if (exception instanceof ThrottlerException) {
      code = "RATE_LIMITED";
      retryable = true;
    } else if (httpStatus !== undefined) {
      code =
        codeByStatus[httpStatus] ??
        (httpStatus >= 500 ? "INTERNAL" : "CONFLICT");
    }

    // A body over the limit fails validation as a whole; it keeps its 413 so
    // a client can tell it from a wrong field (no code of its own yet).
    const status =
      httpStatus === HttpStatus.PAYLOAD_TOO_LARGE
        ? HttpStatus.PAYLOAD_TOO_LARGE
        : errorCodes[code];
    if (refused) {
      // The access log never sees it: body parsing runs before the request
      // logger, which would add the request id.
      this.logger.log(
        {
          requestId: request.id,
          path: request.url,
          method: request.method,
          type: refused.type,
        },
        "Request body refused",
      );
    } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // A 503 is expected while a dependency is down (readiness reports it
      // too): a warning. Anything else is a failure.
      const level =
        status === HttpStatus.SERVICE_UNAVAILABLE ? "warn" : "error";
      this.logger[level](
        { err: exception, path: request.url, method: request.method },
        "Request failed",
      );
    }

    const body: ErrorBody = {
      error: {
        code,
        messageKey: messageKeyFor(code),
        fieldErrors,
        requestId: String(request.id ?? ""),
        retryable,
      },
    };
    response.status(status).json(body);
  }
}
