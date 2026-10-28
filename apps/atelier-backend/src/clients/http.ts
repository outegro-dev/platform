import http from "node:http";
import https from "node:https";
import { PortError } from "../steps/step-handler.js";

/**
 * One HTTP request with a single deadline for the whole exchange. Built on
 * node:http rather than fetch: undici's default headersTimeout (300 s) would
 * cut a model call that waits for a provider slot and then runs for minutes.
 */
function request(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
  },
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "https:" ? https : http;
    const outgoing = client.request(
      target,
      {
        method: options.method,
        headers: {
          ...options.headers,
          ...(options.body === undefined
            ? {}
            : { "content-length": String(Buffer.byteLength(options.body)) }),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
        response.on("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(() => {
      const error = new Error(`no answer within ${options.timeoutMs} ms`);
      error.name = "TimeoutError";
      outgoing.destroy(error);
    }, options.timeoutMs);
    outgoing.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (options.body !== undefined) outgoing.write(options.body);
    outgoing.end();
  });
}

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text.slice(0, 500);
  }
};

/**
 * POST JSON to an internal service with its bearer token. Network failures,
 * timeouts, 429 and 5xx are retryable PortErrors; the body of any non-2xx
 * answer goes to `onError` first (which may throw a more precise PortError).
 */
export async function postJson(
  url: string,
  options: {
    token: string;
    body: unknown;
    timeoutMs: number;
    service: string;
    requestId?: string;
    onError?: (status: number, body: unknown) => never | undefined;
  },
): Promise<unknown> {
  let response: { status: number; text: string };
  try {
    response = await request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.token}`,
        "content-type": "application/json",
        ...(options.requestId ? { "x-request-id": options.requestId } : {}),
      },
      body: JSON.stringify(options.body),
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    const timeout = (error as Error).name === "TimeoutError";
    throw new PortError(
      timeout ? `${options.service}_timeout` : `${options.service}_unavailable`,
      `${options.service}: ${(error as Error).message}`,
      true,
    );
  }
  const body = parse(response.text);
  if (response.status >= 200 && response.status < 300) return body;
  options.onError?.(response.status, body);
  const retryable = response.status >= 500 || response.status === 429;
  throw new PortError(
    retryable
      ? `${options.service}_unavailable`
      : `${options.service}_rejected`,
    `${options.service} answered ${response.status}`,
    retryable,
  );
}

/** GET (or DELETE) JSON with a bearer token; null when the service does not answer. */
export async function getJson(
  url: string,
  token: string,
  timeoutMs = 3000,
  method: "GET" | "DELETE" = "GET",
): Promise<unknown | null> {
  try {
    const response = await request(url, {
      method,
      headers: { authorization: `Bearer ${token}` },
      timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) return null;
    return parse(response.text);
  } catch {
    return null;
  }
}
