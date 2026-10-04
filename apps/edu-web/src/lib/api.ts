import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import {
  type AssistStatus,
  assistStatusSchema,
  type BookResponse,
  bookResponseSchema,
  bookSlugSchema,
  type ChapterResponse,
  chapterResponseSchema,
  type DeckResponse,
  deckResponseSchema,
  type LibraryResponse,
  libraryResponseSchema,
  type PrefaceResponse,
  type ProgressResponse,
  prefaceResponseSchema,
  progressResponseSchema,
} from "@outegro/contracts/edu";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { env } from "./env";

// Every call runs inside a request, so the browser identity is always at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

/** edu-backend: the reader API (`/v1/books…`, `/v1/me/books…`). */
export const eduApi = createBackend(env.EDU_API_URL, { headers: forward });

const authApi = createBackend(env.AUTH_API_URL, { headers: forward });

const accountSchema = z.object({
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
  roles: z.array(z.string()).catch([]),
});
export type Account = z.infer<typeof accountSchema>;

/** Who the header shows: the account, "Sign in", or a menu without a name. */
export type AccountState =
  | { status: "signed-in"; account: Account }
  /** No session, or Identity refused it (401): offer to sign in. */
  | { status: "signed-out" }
  /** A session Identity did not answer about: the menu stays, unnamed. */
  | { status: "unknown" };

/**
 * Who is signed in to the platform (Identity `/v1/me`). A cookie alone does
 * not make the reader signed in: a session Identity refuses shows "Sign
 * in". When Identity is slow or down the menu stays with a generic "Your
 * account", and the books keep working.
 */
export const loadAccount = cache(async (): Promise<AccountState> => {
  const token = await accessToken();
  if (!token) return { status: "signed-out" };
  try {
    const account = accountSchema.parse(
      await authApi<unknown>("/v1/me", { accessToken: token, timeoutMs: 3000 }),
    );
    return { status: "signed-in", account };
  } catch (error) {
    if (error instanceof BackendError && error.status === 401)
      return { status: "signed-out" };
    return { status: "unknown" };
  }
});

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * The outcome of a server-side read, so pages render a clear state instead
 * of crashing: data, "sign in", "no access", missing, or unavailable.
 */
export type Loaded<T> =
  | { status: "ok"; data: T }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "unavailable" };

async function load<T>(
  schema: z.ZodType<T>,
  path: string,
  options: { auth: "required" | "optional" },
): Promise<Loaded<T>> {
  const token = await accessToken();
  if (!token && options.auth === "required") return { status: "signed-out" };
  try {
    const raw = await eduApi<unknown>(path, { accessToken: token });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      console.error(
        `[bff] ${path} answered outside the contract`,
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
    }
    if (!(error instanceof BackendUnavailable || error instanceof BackendError))
      console.error(`[bff] ${path} failed`, error);
    return { status: "unavailable" };
  }
}

/** A slug that can name a book; anything else is a 404 without a call. */
export function isBookSlug(value: string): boolean {
  return bookSlugSchema.safeParse(value).success;
}

/** A chapter number from the URL: 1–999, digits only. */
export function chapterNumber(value: string): number | null {
  if (!/^[1-9]\d{0,2}$/.test(value)) return null;
  return Number(value);
}

/** Published books (staff: all) with the caller's access and progress. */
export const loadLibrary = cache(
  (): Promise<Loaded<LibraryResponse>> =>
    load(libraryResponseSchema, "/v1/books", { auth: "optional" }),
);

/** A book and its table of contents with access per chapter. */
export const loadBook = cache(
  (slug: string): Promise<Loaded<BookResponse>> =>
    load(bookResponseSchema, `/v1/books/${slug}`, { auth: "optional" }),
);

/** A chapter, or why the caller cannot read it (401 sign in, 403 no access). */
export const loadChapter = cache(
  (slug: string, n: number): Promise<Loaded<ChapterResponse>> =>
    load(chapterResponseSchema, `/v1/books/${slug}/chapters/${n}`, {
      auth: "optional",
    }),
);

/** The introduction before chapter 1 (same access as chapter 1). */
export const loadPreface = cache(
  (slug: string): Promise<Loaded<PrefaceResponse>> =>
    load(prefaceResponseSchema, `/v1/books/${slug}/preface`, {
      auth: "optional",
    }),
);

/** Flash cards of the chapters the caller can open. */
export const loadDeck = cache(
  (slug: string): Promise<Loaded<DeckResponse>> =>
    load(deckResponseSchema, `/v1/books/${slug}/cards`, { auth: "optional" }),
);

/** The reader's own progress in a book (signed in only). */
export const loadProgress = cache(
  (slug: string): Promise<Loaded<ProgressResponse>> =>
    load(progressResponseSchema, `/v1/me/books/${slug}/progress`, {
      auth: "required",
    }),
);

/**
 * The reading assistant for the signed-in reader: on or off, and today's
 * answers (`GET /v1/me/assist`). Signed out there is no call.
 */
export const loadAssist = cache(
  (): Promise<Loaded<AssistStatus>> =>
    load(assistStatusSchema, "/v1/me/assist", { auth: "required" }),
);

/** The assistant's status for a page, or null when it is not known. */
export async function assistStatus(): Promise<AssistStatus | null> {
  const loaded = await loadAssist();
  return loaded.status === "ok" ? loaded.data : null;
}

/**
 * A new seed for the first shuffles of a page (exercises, the deck): each
 * visit gets its own order, and the browser hydrates with the same one.
 */
export function newShuffleSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/**
 * The reader of a book page: signed in as far as edu-backend knows (a
 * refused session reads as signed out) and their progress, when it loaded.
 */
export async function loadReader(slug: string): Promise<{
  signedIn: boolean;
  progress: ProgressResponse | null;
}> {
  const loaded = await loadProgress(slug);
  return {
    signedIn: loaded.status !== "signed-out",
    progress: loaded.status === "ok" ? loaded.data : null,
  };
}
