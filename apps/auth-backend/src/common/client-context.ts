import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

export type ClientContext = {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

/** Client IP (behind Traefik, `trust proxy` = 1), user agent and request id. */
export const Client = createParamDecorator(
  (_: unknown, context: ExecutionContext): ClientContext => {
    const request = context
      .switchToHttp()
      .getRequest<Request & { id?: string }>();
    return {
      ip: request.ip ?? null,
      userAgent: request.headers["user-agent"]?.slice(0, 400) ?? null,
      requestId: request.id ? String(request.id) : null,
    };
  },
);
