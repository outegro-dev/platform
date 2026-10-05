import {
  BackendError,
  BackendUnavailable,
  type RequestOptions,
} from "@outegro/bff/backend";
import type { z } from "zod";
import { ContractMismatch, NotConnected } from "../result";

/** A bound service client (`createBackend` from @outegro/bff/backend). */
export type Call = <T>(path: string, options?: RequestOptions) => Promise<T>;

export type Transport = {
  call: Call;
  /** The operator's access token for this request; null when signed out. */
  token: () => Promise<string | null>;
};

export type Query = Record<
  string,
  string | number | boolean | null | undefined
>;

/** `/path?a=1` without empty values, so URLs stay short and cacheable. */
export function withQuery(path: string, query: Query = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** Response validation for services whose contract is still moving. */
export function parse<S extends z.ZodType>(
  schema: S,
  data: unknown,
  what: string,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(
      `[admin-web] ${what} answered outside the expected shape`,
      result.error.issues.slice(0, 3),
    );
    throw new ContractMismatch(what);
  }
  return result.data;
}

/**
 * One platform service behind the operator's token. The browser never sees
 * the token, and the actor of every command is whoever the token belongs to:
 * no request body carries an actor id.
 */
export abstract class ServiceAdapter {
  constructor(protected readonly transport: Transport) {}

  protected async get<T>(path: string, query?: Query): Promise<T> {
    return this.transport.call<T>(withQuery(path, query), {
      accessToken: await this.transport.token(),
    });
  }

  protected async send<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
  ): Promise<T> {
    return this.transport.call<T>(path, {
      method,
      body,
      accessToken: await this.transport.token(),
    });
  }
}

/**
 * A service that may not be deployed yet. No base URL, no answer, or a
 * missing admin API all read as "not connected", so the section shows one
 * calm state instead of an error loop.
 */
export abstract class OptionalServiceAdapter {
  constructor(
    readonly service: "battleship" | "payments" | "education",
    protected readonly transport: Transport | null,
  ) {}

  get configured(): boolean {
    return this.transport !== null;
  }

  protected async get<T>(
    path: string,
    query?: Query,
    options: { list?: boolean } = {},
  ): Promise<T> {
    const transport = this.require();
    try {
      return await transport.call<T>(withQuery(path, query), {
        accessToken: await transport.token(),
      });
    } catch (error) {
      throw this.translate(error, options.list ?? false);
    }
  }

  protected async send<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
  ): Promise<T> {
    const transport = this.require();
    try {
      return await transport.call<T>(path, {
        method,
        body,
        accessToken: await transport.token(),
      });
    } catch (error) {
      throw this.translate(error, false);
    }
  }

  private require(): Transport {
    if (!this.transport) throw new NotConnected(this.service, "unconfigured");
    return this.transport;
  }

  private translate(error: unknown, list: boolean): unknown {
    // Refused connection, timeout, a gateway without a JSON body, or an HTML
    // page from something that is not the service: it does not answer yet.
    if (error instanceof BackendUnavailable || error instanceof SyntaxError)
      return new NotConnected(this.service, "unreachable");
    // A list endpoint that does not exist: an older build without the admin API.
    if (list && error instanceof BackendError && error.status === 404)
      return new NotConnected(this.service, "unreachable");
    return error;
  }
}
