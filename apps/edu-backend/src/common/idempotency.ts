import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@outegro/nest-common";
import type { Request } from "express";
import { z } from "zod";

const keySchema = z.uuid();

/**
 * The optional `Idempotency-Key` header of a progress write: a UUID (lower
 * case), null when absent, 400 when anything else (a doubled header too).
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, context: ExecutionContext): string | null => {
    const header = context.switchToHttp().getRequest<Request>().headers[
      "idempotency-key"
    ];
    if (header === undefined) return null;
    const parsed = keySchema.safeParse(header);
    if (!parsed.success)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { "Idempotency-Key": ["a UUID"] },
      });
    return parsed.data.toLowerCase();
  },
);
