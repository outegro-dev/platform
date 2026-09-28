/**
 * Server-side calls from a Next.js BFF to platform services. The browser
 * never talks to them directly and never sees a token.
 */

export type ApiError = {
  code: string;
  messageKey: string;
  fieldErrors: Record<string, string[]>;
  requestId: string;
  retryable: boolean;
};

/** The service answered with a contract error body. */
export class BackendError extends Error {
  constructor(
    readonly status: number,
    readonly error: ApiError,
  ) {
    super(`${status} ${error.code}`);
  }
}

/** The service could not be reached or timed out (show retry, not "empty"). */
export class BackendUnavailable extends Error {}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export type BackendOptions = {
  /** Extra headers for every call, e.g. the browser identity from `clientHeaders`. */
  headers?: () => Promise<Record<string, string>> | Record<string, string>;
};

export function createBackend(baseUrl: string, defaults: BackendOptions = {}) {
  return async function call<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const shared = (await defaults.headers?.()) ?? {};
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          accept: "application/json",
          ...shared,
          ...(options.body !== undefined
            ? { "content-type": "application/json" }
            : {}),
          ...(options.accessToken
            ? { authorization: `Bearer ${options.accessToken}` }
            : {}),
          ...options.headers,
        },
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      });
    } catch (error) {
      throw new BackendUnavailable((error as Error).message);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!response.ok) {
      if (response.status >= 500 && !data?.error)
        throw new BackendUnavailable(`HTTP ${response.status}`);
      throw new BackendError(
        response.status,
        data?.error ?? {
          code: "INTERNAL",
          messageKey: "errors.internal",
          fieldErrors: {},
          requestId: "",
          retryable: false,
        },
      );
    }
    return data as T;
  };
}
