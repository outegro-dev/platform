import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import {
  REFRESH_COOKIE,
  type SessionTokens,
  writeSession,
} from "@outegro/bff/session";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import type { z } from "zod";
import { env } from "./env";
import type { Permission } from "./permissions";
import { NotConnected } from "./result";
import {
  accessToken,
  createServices,
  forwardedHeaders,
  type Services,
} from "./server";

/**
 * Operator commands (server actions): permission re-checked against a fresh
 * `/v1/me`, input validated, the service called with the operator's own
 * token (the actor is whoever the token belongs to; no actor id is ever
 * taken from the browser), then the page re-rendered with fresh data.
 */

export type ActionCode =
  | "invalid"
  | "forbidden"
  | "unauthenticated"
  | "not-found"
  | "conflict"
  | "version-conflict"
  | "unavailable"
  | "not-connected"
  | "rate-limited"
  | "last-owner"
  | "last-method"
  | "role-active"
  | "not-retryable"
  | "expired"
  | "private"
  | "confirm-required"
  | "grant-exists"
  | "not-live"
  | "state"
  | "same-status"
  | "same-rule"
  | "free-chapters"
  | "rule-refused"
  | "insufficient-funds"
  | "amount-too-large"
  | "same-balance"
  | "round-closed";

export type ActionResult =
  | { status: "idle" }
  | { status: "success"; message: string; at: number }
  | { status: "error"; code: ActionCode; message: string; at: number };

export const idle: ActionResult = { status: "idle" };

/** Swap the refresh token for a new pair (a command got 401: stale token). */
async function forceRefresh(): Promise<string | null> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return null;
  try {
    const tokens = await createBackend(env.AUTH_API_URL, {
      headers: forwardedHeaders,
    })<SessionTokens>("/v1/sessions/refresh", {
      method: "POST",
      body: { refreshToken },
    });
    writeSession(jar, tokens, env.APP_URL.startsWith("https:"));
    return tokens.accessToken;
  } catch {
    return null;
  }
}

export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type CommandOptions<S extends z.ZodType, R> = {
  permission: Permission;
  schema: S;
  form: FormData;
  run: (services: Services, input: z.infer<S>) => Promise<R>;
  /** Domain-specific meaning of a refusal (409 / 422 …). */
  explain?: (error: BackendError, input: z.infer<S>) => ActionCode | null;
};

type Outcome<I, R> =
  | { ok: true; input: I; value: R }
  | { ok: false; code: ActionCode };

/**
 * The core of every command: the input validated, the permission checked
 * against a fresh `/v1/me`, the service called with the operator's own
 * token. A 401 means the token is older than the actor's latest role
 * change (admin commands insist on a newer one): the session is refreshed
 * once and the command sent again.
 */
async function perform<S extends z.ZodType, R>(
  options: CommandOptions<S, R>,
): Promise<Outcome<z.infer<S>, R>> {
  const parsed = options.schema.safeParse(
    Object.fromEntries(options.form.entries()),
  );
  if (!parsed.success) return { ok: false, code: "invalid" };
  const input = parsed.data as z.infer<S>;

  let token = await accessToken();
  if (!token) return { ok: false, code: "unauthenticated" };
  const services = createServices(async () => token);

  let value: R | undefined;
  const attempt = async (): Promise<ActionCode | null> => {
    try {
      const operator = await services.identity.me();
      if (!operator.permissions.includes(options.permission))
        return "forbidden";
      value = await options.run(services, input);
      return null;
    } catch (error) {
      if (error instanceof NotConnected) return "not-connected";
      if (error instanceof BackendUnavailable) return "unavailable";
      if (!(error instanceof BackendError)) {
        console.error("[admin-web] action failed", error);
        return "unavailable";
      }
      if (error.status === 401) return "unauthenticated";
      if (error.status === 403) return "forbidden";
      if (error.status === 429) return "rate-limited";
      const explained = options.explain?.(error, input);
      if (explained) return explained;
      if (error.status === 404) return "not-found";
      if (error.error.code === "VERSION_CONFLICT") return "version-conflict";
      if (error.status === 409) return "conflict";
      if (error.status === 400 || error.status === 422) return "invalid";
      return "unavailable";
    }
  };

  let code = await attempt();
  if (code === "unauthenticated") {
    // Admin commands insist on a token issued after the latest role change.
    token = await forceRefresh();
    if (!token) return { ok: false, code: "unauthenticated" };
    code = await attempt();
  }
  if (code) return { ok: false, code };
  return { ok: true, input, value: value as R };
}

const failure = (t: Translate, code: ActionCode): ActionResult => {
  // A conflict means the page shows stale data: show the current state.
  if (
    code === "version-conflict" ||
    code === "conflict" ||
    code === "round-closed"
  )
    refresh();
  return {
    status: "error",
    code,
    message: t(`errors.${code}`),
    at: Date.now(),
  };
};

export async function runAction<S extends z.ZodType>(
  options: CommandOptions<S, void> & {
    /** Success text, already translated. */
    success: (t: Translate, input: z.infer<S>) => string;
  },
): Promise<ActionResult> {
  const t = (await getTranslations("actions")) as unknown as Translate;
  const outcome = await perform(options);
  if (!outcome.ok) return failure(t, outcome.code);
  refresh();
  return {
    status: "success",
    message: options.success(t, outcome.input),
    at: Date.now(),
  };
}

/** What the service said a command would do; nothing has changed yet. */
export type Previewed<P> = { status: "preview"; preview: P; at: number };
export type CommandResult<P> = ActionResult | Previewed<P>;

/**
 * A command the service previews first: the form posts `intent=preview`,
 * the service answers what would change (`preview: true` in its body), the
 * operator confirms, and the same form comes back with `intent=confirm`
 * (the same body without `preview`). Both steps go through the same checks
 * and the same token refresh.
 */
export async function runPreviewable<S extends z.ZodType, P>(
  options: Omit<CommandOptions<S, P>, "run"> & {
    run: (
      services: Services,
      input: z.infer<S>,
      preview: boolean,
    ) => Promise<P>;
    /** Success text after the confirmed command, already translated. */
    success: (t: Translate, input: z.infer<S>, result: P) => string;
  },
): Promise<CommandResult<P>> {
  const t = (await getTranslations("actions")) as unknown as Translate;
  const intent = options.form.get("intent");
  if (intent !== "preview" && intent !== "confirm")
    return failure(t, "invalid");
  const preview = intent === "preview";
  const outcome = await perform({
    ...options,
    run: (services, input) => options.run(services, input, preview),
  });
  if (!outcome.ok) return failure(t, outcome.code);
  if (preview)
    return { status: "preview", preview: outcome.value, at: Date.now() };
  refresh();
  return {
    status: "success",
    message: options.success(t, outcome.input, outcome.value),
    at: Date.now(),
  };
}
