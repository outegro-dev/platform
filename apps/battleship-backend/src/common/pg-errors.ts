/** A PostgreSQL unique violation (23505), possibly wrapped by Drizzle. */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505")
      return !constraint || candidate.constraint === constraint;
    current = candidate.cause;
  }
  return false;
}
