import { timingSafeEqual } from "node:crypto";
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "./errors.js";

/**
 * Service-to-service calls inside the cluster (e.g. Identity → Notifications
 * for login codes). A shared bearer token plus NetworkPolicy; routes using it
 * are also marked @Public() so the user JWT guard is skipped.
 */
export function createServiceTokenGuard(token: () => string) {
  @Injectable()
  class ServiceTokenGuard implements CanActivate {
    canActivate(context: ExecutionContext) {
      const header =
        context.switchToHttp().getRequest<Request>().headers.authorization ??
        "";
      const presented = Buffer.from(
        header.startsWith("Bearer ") ? header.slice(7) : "",
      );
      const expected = Buffer.from(token());
      if (
        expected.length < 32 ||
        presented.length !== expected.length ||
        !timingSafeEqual(presented, expected)
      ) {
        throw new AppError("UNAUTHENTICATED");
      }
      return true;
    }
  }
  return ServiceTokenGuard;
}

/** Calls another service's internal API with the shared token and a timeout. */
export async function callInternal<T>(
  url: string,
  options: {
    token: string;
    body: unknown;
    timeoutMs?: number;
    requestId?: string;
  },
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.token}`,
      "content-type": "application/json",
      ...(options.requestId ? { "x-request-id": options.requestId } : {}),
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
  });
  if (!response.ok)
    throw new Error(`Internal call failed with ${response.status}`);
  return (await response.json()) as T;
}
