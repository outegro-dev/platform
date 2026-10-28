/**
 * The only way this package reaches the network. Every adapter takes an
 * `Http`, so tests replay recorded responses and the backend can share one
 * rate-limited client between workers.
 */

export type HttpInit = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  accept?: "json" | "html";
};

export type HttpResponse = {
  status: number;
  /** Where redirects ended. */
  url: string;
  /** Header names in lower case. */
  headers: Record<string, string>;
  text: string;
};

export type Http = {
  get(url: string, init?: HttpInit): Promise<HttpResponse>;
};

export const defaultUserAgent =
  "Mozilla/5.0 (compatible; AtelierBot/1.0; +https://atelier.outegro.dev)";

export type CreateHttpOptions = {
  /** Minimum time between two requests to the same host. */
  perHostIntervalMs?: number;
  userAgent?: string;
  /** Default timeout of one request; `init.timeoutMs` overrides it. */
  timeoutMs?: number;
  /** Largest body kept, in characters; the rest is dropped. */
  maxBodyChars?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const acceptHeader = {
  json: "application/json",
  html: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  any: "text/html,application/json;q=0.9,*/*;q=0.8",
} as const;

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A token bucket per host with one token that refills every
 * `perHostIntervalMs`: requests to one host start at least that far apart,
 * requests to different hosts do not wait for each other.
 */
export function createHostLimiter(
  intervalMs: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = wait,
) {
  const nextSlot = new Map<string, number>();
  return async (host: string) => {
    const at = now();
    const slot = Math.max(at, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + intervalMs);
    if (slot > at) await sleep(slot - at);
  };
}

export class HttpRequestError extends Error {
  constructor(
    readonly url: string,
    message: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

/** Global `fetch` behind a per-host limit and a timeout (30 s by default). */
export function createHttp(options: CreateHttpOptions = {}): Http {
  const {
    perHostIntervalMs = 1000,
    userAgent = defaultUserAgent,
    timeoutMs = 30_000,
    maxBodyChars = 8_000_000,
  } = options;
  const doFetch = options.fetch ?? fetch;
  const limit = createHostLimiter(
    perHostIntervalMs,
    options.now,
    options.sleep,
  );
  return {
    async get(url, init = {}) {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw new HttpRequestError(
          url,
          `Unsupported protocol ${parsed.protocol}`,
        );
      await limit(parsed.hostname.toLowerCase());
      const headers: Record<string, string> = {
        "user-agent": userAgent,
        accept: acceptHeader[init.accept ?? "any"],
        "accept-language": "en-US,en;q=0.8,ru;q=0.6",
        ...lowerKeys(init.headers ?? {}),
      };
      const timeout = init.timeoutMs ?? timeoutMs;
      let response: Response;
      try {
        response = await doFetch(url, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(timeout),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");
        throw new HttpRequestError(
          url,
          timedOut
            ? `Timed out after ${timeout} ms`
            : `Request failed: ${describe(error)}`,
          timedOut,
        );
      }
      let text: string;
      try {
        text = await response.text();
      } catch (error) {
        throw new HttpRequestError(url, `Body failed: ${describe(error)}`);
      }
      const out: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
      });
      return {
        status: response.status,
        url: response.url || url,
        headers: out,
        text: text.length > maxBodyChars ? text.slice(0, maxBodyChars) : text,
      };
    },
  };
}

function lowerKeys(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  return cause instanceof Error
    ? `${error.message} (${cause.message})`
    : error.message;
}

let shared: Http | undefined;
/** One client per process, so the per-host limit holds across calls. */
export function defaultHttp(): Http {
  shared ??= createHttp();
  return shared;
}

/** Parses a JSON body; `null` when it is not JSON. */
export function json<T = unknown>(response: HttpResponse): T | null {
  try {
    return JSON.parse(response.text) as T;
  } catch {
    return null;
  }
}
