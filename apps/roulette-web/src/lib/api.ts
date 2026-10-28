import { BackendError, createBackend } from "@outegro/bff/backend";
import { clientHeaders } from "@outegro/bff/client";
import { ACCESS_COOKIE } from "@outegro/bff/session";
import {
  type FairInfo,
  type FairRound,
  fairInfoSchema,
  fairRoundSchema,
  type HistoryItem,
  historyPageSchema,
  type RouletteMe,
  rouletteMeSchema,
} from "@outegro/contracts/roulette";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { env } from "./env";
import { balanceOf } from "./wallet";

// Every call runs inside a request, so the browser identity is always at hand.
const forward = async () =>
  clientHeaders(await headers(), env.CLIENT_IP_SOURCE);

/** roulette-backend: the player API (`/v1/me`, tickets) and the public rounds. */
export const rouletteApi = createBackend(env.ROULETTE_API_URL, {
  headers: forward,
});

const authApi = createBackend(env.AUTH_API_URL, { headers: forward });

const walletApi = createBackend(env.WALLET_API_URL, { headers: forward });

/**
 * The player's grumbles straight from the wallet, for when the game did not
 * say (its balance is null when the wallet answered without one).
 */
export async function loadWalletBalance(): Promise<number | null> {
  const token = await accessToken();
  if (!token) return null;
  try {
    return balanceOf(
      await walletApi<unknown>("/v1/me/wallet", {
        accessToken: token,
        timeoutMs: 3000,
      }),
    );
  } catch {
    return null;
  }
}

const accountSchema = z.object({
  email: z.string().nullable().catch(null),
  displayName: z.string().nullable().catch(null),
  roles: z.array(z.string()).catch([]),
});
export type Account = z.infer<typeof accountSchema>;

export async function accessToken() {
  return (await cookies()).get(ACCESS_COOKIE)?.value ?? null;
}

/**
 * Who is signed in to the platform (Identity `/v1/me`), for the account
 * links only: the name and email never reach the game. Optional: when
 * Identity is slow or down the header says "Your account".
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

/**
 * The outcome of a server-side read, so pages render a clear state instead
 * of crashing: data, "sign in", missing, or unavailable.
 */
export type Loaded<T> =
  | { status: "ok"; data: T }
  | { status: "signed-out" }
  | { status: "not-found" }
  | { status: "unavailable" };

async function load<T>(
  schema: z.ZodType<T>,
  path: string,
  options: { auth: "required" | "none" },
): Promise<Loaded<T>> {
  const token = options.auth === "required" ? await accessToken() : null;
  if (!token && options.auth === "required") return { status: "signed-out" };
  try {
    const raw = await rouletteApi<unknown>(path, {
      accessToken: token,
      timeoutMs: 4000,
    });
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
      if (error.status === 404) return { status: "not-found" };
    }
    return { status: "unavailable" };
  }
}

/** The signed-in player: roulette nickname and grumbles (null: the wallet did not say). */
export const loadMe = cache(
  (): Promise<Loaded<RouletteMe>> =>
    load(rouletteMeSchema, "/v1/me", { auth: "required" }),
);

/** The latest results, public. */
export async function loadHistory(limit = 20): Promise<Loaded<HistoryItem[]>> {
  const page = await load(historyPageSchema, `/v1/rounds?limit=${limit}`, {
    auth: "none",
  });
  return page.status === "ok" ? { status: "ok", data: page.data.items } : page;
}

/** The published chain: commit, public seed, length. */
export function loadFair(): Promise<Loaded<FairInfo>> {
  return load(fairInfoSchema, "/v1/fair", { auth: "none" });
}

/** One round with everything needed to check it. */
export function loadRound(round: number): Promise<Loaded<FairRound>> {
  return load(fairRoundSchema, `/v1/rounds/${round}`, { auth: "none" });
}
