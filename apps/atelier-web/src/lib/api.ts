import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import { permissionsOf } from "@outegro/contracts/access";
import {
  type ApplicationDetail,
  applicationDetailSchema,
  type Board,
  boardSchema,
  type Inbox,
  inboxSchema,
  type PipelineOverview,
  pipelineOverviewSchema,
} from "@outegro/contracts/atelier";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { env, mockMode } from "./env";
import { mockBackend } from "./mock";
import { type ProfileSummary, profileSummarySchema } from "./schemas";

/*
 * The BFF side of the app: who is signed in, and every call to
 * atelier-backend with the owner's access token (server to server; the
 * browser never sees a token). In mock mode the same calls go to the fake
 * backend in mock.ts and sign-in is skipped. Every answer is checked
 * against the contract before anything renders it.
 */

// Every call runs inside a request, so the browser identity is at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

const atelierHttp = mockMode
  ? null
  : createBackend(env.ATELIER_API_URL, { headers: forward });

const authApi = createBackend(env.AUTH_API_URL, { headers: forward });

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

const meSchema = z.object({
  id: z.string().min(1),
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
  roles: z.array(z.string()).catch([]),
});
export type Viewer = z.infer<typeof meSchema>;

/** Who is looking: allowed in, not signed in, signed in without access, or unknown. */
export type ViewerState =
  | { status: "allowed"; viewer: Viewer; mock: boolean }
  | { status: "signed-out" }
  | { status: "no-access"; viewer: Viewer }
  /** Identity did not answer: the page says so and offers a retry. */
  | { status: "unknown" };

const mockViewer: Viewer = {
  id: "00000000-0000-4000-8000-000000000000",
  email: "owner@atelier.example",
  displayName: "Mock owner",
  roles: ["owner"],
};

/**
 * The signed-in user from Identity (`/v1/me`), once per request. Atelier
 * is for holders of the `atelier.use` permission (the owner role has it);
 * everyone else gets a polite "no access". Mock mode lets everyone in.
 */
export const loadViewer = cache(async (): Promise<ViewerState> => {
  if (mockMode) return { status: "allowed", viewer: mockViewer, mock: true };
  const token = await accessToken();
  if (!token) return { status: "signed-out" };
  try {
    const viewer = meSchema.parse(
      await authApi<unknown>("/v1/me", { accessToken: token, timeoutMs: 4000 }),
    );
    return permissionsOf(viewer.roles).has("atelier.use")
      ? { status: "allowed", viewer, mock: false }
      : { status: "no-access", viewer };
  } catch (error) {
    if (error instanceof BackendError && error.status === 401)
      return { status: "signed-out" };
    console.error("[bff] Identity /v1/me failed", (error as Error).message);
    return { status: "unknown" };
  }
});

/** The outcome of a call, so pages and handlers say what happened instead of crashing. */
export type Loaded<T> =
  | { status: "ok"; data: T }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "not-found" }
  /** The backend refused the input (400/422) or the state (409). */
  | { status: "invalid"; code: string }
  | { status: "conflict"; code: string }
  | { status: "unavailable" };

type Method = "GET" | "POST" | "DELETE";

async function send(
  method: Method,
  path: string,
  body: unknown,
  token: string | null,
): Promise<unknown> {
  if (mockMode) {
    const answer = mockBackend(method, path, body);
    if (answer.status >= 400) {
      const failure = (answer.body as { error: BackendError["error"] }).error;
      throw new BackendError(answer.status, failure);
    }
    // Through JSON, as over the network: no shared references leak out.
    return answer.body === undefined
      ? undefined
      : JSON.parse(JSON.stringify(answer.body));
  }
  if (!atelierHttp) throw new BackendUnavailable("no backend");
  return atelierHttp<unknown>(path, {
    method,
    body,
    accessToken: token,
    timeoutMs: method === "GET" ? 8000 : 15000,
  });
}

/**
 * One call to atelier-backend, its answer validated with `schema`. A 204
 * (no body) passes when `schema` accepts undefined.
 */
export async function callAtelier<T>(
  schema: z.ZodType<T>,
  method: Method,
  path: string,
  body?: unknown,
): Promise<Loaded<T>> {
  const viewer = await loadViewer();
  if (viewer.status === "signed-out") return { status: "signed-out" };
  if (viewer.status === "no-access") return { status: "forbidden" };
  const token = mockMode ? null : await accessToken();
  try {
    const raw = await send(method, path, body, token);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[bff] ${method} ${path} answered outside the contract`,
        parsed.error.issues[0],
      );
      return { status: "unavailable" };
    }
    return { status: "ok", data: parsed.data };
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.status === 401) return { status: "signed-out" };
      if (error.status === 403) return { status: "forbidden" };
      if (error.status === 404) return { status: "not-found" };
      if (error.status === 409)
        return { status: "conflict", code: error.error.code };
      if (error.status === 400 || error.status === 422)
        return { status: "invalid", code: error.error.code };
    } else if (!(error instanceof BackendUnavailable))
      console.error(`[bff] ${method} ${path} failed`, error);
    return { status: "unavailable" };
  }
}

/** An application id from the URL: a UUID, anything else is a 404 without a call. */
export function isApplicationId(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

export const loadBoard = cache(
  (): Promise<Loaded<Board>> => callAtelier(boardSchema, "GET", "/board"),
);

export const loadApplication = cache(
  async (id: string): Promise<Loaded<ApplicationDetail>> => {
    const loaded = await callAtelier(
      applicationDetailSchema,
      "GET",
      `/applications/${id}`,
    );
    // The backend's PDF address is its own (/v1/...): the page reads it
    // through this app, same origin, with the owner's token.
    if (loaded.status === "ok" && loaded.data.cv && !mockMode)
      loaded.data.cv.pdfUrl = `/api/atelier/applications/${id}/cv`;
    return loaded;
  },
);

export const loadInbox = cache(
  (): Promise<Loaded<Inbox>> => callAtelier(inboxSchema, "GET", "/inbox"),
);

export const loadPipeline = cache(
  (): Promise<Loaded<PipelineOverview>> =>
    callAtelier(pipelineOverviewSchema, "GET", "/pipeline"),
);

export const loadProfile = cache(
  (): Promise<Loaded<ProfileSummary>> =>
    callAtelier(profileSummarySchema, "GET", "/profile"),
);
