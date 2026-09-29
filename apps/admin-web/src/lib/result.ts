import { BackendError, BackendUnavailable } from "@outegro/bff/backend";

/**
 * An optional service (battleship, payments) has no base URL yet, or does not
 * answer: the section shows "not connected yet", never an error loop.
 */
export class NotConnected extends Error {
  constructor(
    readonly service: string,
    readonly reason: "unconfigured" | "unreachable",
  ) {
    super(`${service}: ${reason}`);
  }
}

/** The service answered, but outside the shape its adapter expects. */
export class ContractMismatch extends Error {}

export type Failure =
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "unavailable"; requestId: string | null }
  | { kind: "not-connected"; reason: "unconfigured" | "unreachable" };
export type FailureKind = Failure["kind"];

/** A server-side read: data, or the reason there is none (never fake zeros). */
export type Loaded<T> = { ok: true; data: T } | ({ ok: false } & Failure);

export function failureOf(error: unknown): Failure {
  if (error instanceof NotConnected)
    return { kind: "not-connected", reason: error.reason };
  if (error instanceof BackendError) {
    if (error.status === 401) return { kind: "unauthenticated" };
    if (error.status === 403) return { kind: "forbidden" };
    if (error.status === 404) return { kind: "not-found" };
    return { kind: "unavailable", requestId: error.error.requestId || null };
  }
  if (!(error instanceof BackendUnavailable)) {
    // A bug or a contract drift: logged on the server, shown as "unavailable".
    console.error("[admin-web] read failed", error);
  }
  return { kind: "unavailable", requestId: null };
}

export async function load<T>(run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    return { ok: false, ...failureOf(error) };
  }
}

export type Page<T> = { items: T[]; nextCursor: string | null };
