/** What of an error may reach the log. */
export type LoggableError = { readonly name: string; readonly code?: string };

const NAME = /^[A-Za-z][\w$]{0,63}$/;
/** SQLSTATE (23505, P0001), Node (ECONNRESET, ERR_STREAM_DESTROYED) and the like. */
const CODE = /^[A-Z0-9_]{2,40}$/;

const nameOf = (error: Error): string => {
  for (const name of [error.name, error.constructor?.name])
    if (typeof name === "string" && name !== "Error" && NAME.test(name))
      return name;
  return "Error";
};

/**
 * An error as the log may keep it: its class and a code, never its message,
 * stack or other fields. A failed query's message and parameters hold what
 * it tried to write (DrizzleQueryError: an answer of the model on its way to
 * the cache), a parser's message quotes its input: around the assistant
 * either may be the model's answer or the reader's words. The code is the
 * first one along the `cause` chain (a query error wraps the driver's).
 */
export function loggableError(error: unknown): LoggableError {
  if (!(error instanceof Error))
    return { name: error === null ? "null" : typeof error };
  let code: string | undefined;
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    const candidate = (current as { code?: unknown }).code;
    if (typeof candidate === "string" && CODE.test(candidate)) {
      code = candidate;
      break;
    }
    current = current.cause;
  }
  return { name: nameOf(error), ...(code === undefined ? {} : { code }) };
}
