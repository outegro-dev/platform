import { type ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import type { LlmError } from "@outegro/contracts/atelier";
import { AppError, ErrorFilter } from "@outegro/nest-common";
import type { Request, Response } from "express";
import { CallAborted, LlmFailure } from "../domain/failures.js";

const GENERATE = "/v1/generate";

/** A refused /v1/generate body (invalid JSON, wrong fields, too large) as an LlmError. */
function badRequest(
  exception: unknown,
): { status: number; body: LlmError } | null {
  let message: string | null = null;
  let status = 400;
  if (exception instanceof AppError && exception.code === "VALIDATION_FAILED")
    message = Object.entries(exception.fieldErrors)
      .map(([field, errors]) => `${field}: ${errors.join(", ")}`)
      .join("; ");
  else if (exception instanceof HttpException && exception.getStatus() < 500) {
    status = exception.getStatus() === 413 ? 413 : 400;
    message =
      status === 413
        ? "The request body is too large"
        : "The request body is not valid JSON";
  } else {
    const {
      expose,
      status: refused,
      type,
    } = (exception ?? {}) as {
      expose?: unknown;
      status?: unknown;
      type?: unknown;
    };
    if (
      expose === true &&
      typeof refused === "number" &&
      refused >= 400 &&
      refused < 500
    ) {
      status = refused === 413 ? 413 : 400;
      message = `The request body was refused (${String(type ?? refused)})`;
    }
  }
  if (message === null) return null;
  return {
    status,
    body: {
      error: "bad_request",
      retryable: false,
      message: (message || "Invalid request").slice(0, 2000),
      resetsAt: null,
    },
  };
}

/**
 * Generation errors in the gateway contract shape (LlmError); everything else
 * (auth, unknown routes, health) in the platform shape of ErrorFilter.
 */
@Catch()
export class LlmErrorFilter extends ErrorFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    if (exception instanceof CallAborted) {
      // The caller is gone; nobody reads an answer.
      if (!response.headersSent) response.status(499).end();
      return;
    }
    if (exception instanceof LlmFailure) {
      response.status(exception.status).json(exception.toBody());
      return;
    }
    if (request.path === GENERATE) {
      const refused = badRequest(exception);
      if (refused) {
        response.status(refused.status).json(refused.body);
        return;
      }
    }
    super.catch(exception, host);
  }
}
