import {
  BackendError,
  BackendUnavailable,
  createBackend,
} from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import { pageSchema } from "@outegro/contracts";
import {
  type Leaderboard,
  leaderboardSchema,
  matchReplaySchema,
  matchSummarySchema,
  type PlayerProfile,
  type PlayerStats,
  playerProfileSchema,
  playerStatsSchema,
} from "@outegro/contracts/battleship";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import type { HistoryPage, MatchReplay } from "@/game/stores/stats-store";
import { env } from "./env";
import { PaymentsClient } from "./payments-client";

// Every call runs inside a request, so the browser identity is always at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

export const battleshipApi = createBackend(env.BATTLESHIP_API_URL, {
  headers: forward,
});

const authApi = createBackend(env.AUTH_API_URL, { headers: forward });

const accountSchema = z.object({
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
  roles: z.array(z.string()).catch([]),
});
export type Account = z.infer<typeof accountSchema>;

/**
 * Who is signed in to the platform (Identity `/v1/me`), for the account
 * menu only: the name and email are shown to the player and never passed
 * to the game server. Optional: when Identity is slow or down the menu
 * falls back to a generic "Your account" and the game keeps working.
 */
export const loadAccount = cache(async (): Promise<Account | null> => {
  const token = await accessToken();
  if (!token) return null;
  try {
    return accountSchema.parse(
      await authApi<unknown>("/v1/me", { accessToken: token, timeoutMs: 3000 }),
    );
  } catch {
    return null;
  }
});

/** All calls to the payments service go through this one client. */
export const payments = new PaymentsClient({
  baseUrl: env.PAYMENTS_API_URL,
  appUrl: env.APP_URL,
  checkoutOrigins: env.CHECKOUT_ORIGINS,
  headers: forward,
});

export const matchHistorySchema = pageSchema(matchSummarySchema);

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * The outcome of a server-side read, so pages render a clear state instead
 * of crashing: data, "sign in", "Premium only", missing, or unavailable.
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
    const raw = await battleshipApi<unknown>(path, { accessToken: token });
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

/** The player's profile (one call per request, shared by layout and page). */
export const loadProfile = cache(
  (): Promise<Loaded<PlayerProfile>> =>
    load(playerProfileSchema, "/v1/me", { auth: "required" }),
);

export function loadLeaderboard(
  period: "all" | "week",
): Promise<Loaded<Leaderboard>> {
  return load(leaderboardSchema, `/v1/leaderboard?period=${period}`, {
    auth: "optional",
  });
}

export function loadStats(): Promise<Loaded<PlayerStats>> {
  return load(playerStatsSchema, "/v1/me/stats", { auth: "required" });
}

export function loadMatches(
  cursor: string | null,
  limit = 10,
): Promise<Loaded<HistoryPage>> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return load(matchHistorySchema, `/v1/me/matches?${query}`, {
    auth: "required",
  });
}

export function loadReplay(matchId: string): Promise<Loaded<MatchReplay>> {
  return load(
    matchReplaySchema,
    `/v1/matches/${encodeURIComponent(matchId)}/replay`,
    {
      auth: "required",
    },
  );
}
