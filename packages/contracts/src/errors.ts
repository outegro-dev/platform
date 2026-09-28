import { z } from "zod";

/** Stable machine-readable error codes (HTTP contract v1). */
export const errorCodes = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DEPENDENCY_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof errorCodes;

export const errorBodySchema = z.object({
  error: z.object({
    code: z.enum(Object.keys(errorCodes) as [ErrorCode, ...ErrorCode[]]),
    /** i18n key for the client, never a raw server message. */
    messageKey: z.string(),
    fieldErrors: z.record(z.string(), z.array(z.string())),
    requestId: z.string(),
    retryable: z.boolean(),
  }),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const messageKeyFor = (code: ErrorCode) =>
  `errors.${code.toLowerCase().replace(/_(\w)/g, (_, c: string) => c.toUpperCase())}`;
