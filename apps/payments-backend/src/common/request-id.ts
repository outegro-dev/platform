import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** The request id assigned by the logger (x-request-id), for audit and correlation. */
export const RequestId = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | null => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { id?: string }>();
    return request.id ? String(request.id) : null;
  },
);
