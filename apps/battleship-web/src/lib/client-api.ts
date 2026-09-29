import {
  leaderboardSchema,
  matchSummarySchema,
  playerProfileSchema,
} from "@outegro/contracts/battleship";
import { z } from "zod";
import { equipCosmetics, startCheckout } from "@/app/actions";
import type { ProfileSource } from "@/game/stores/session-store";
import type { ShopApi } from "@/game/stores/shop-store";
import type { StatsApi } from "@/game/stores/stats-store";
import { type SubscriptionSummary, subscriptionStates } from "./ownership";

/*
 * Browser-side adapters for the stores' server calls: BFF routes for reads,
 * server actions for changes. Responses are validated like any other input.
 */

const historyPageSchema = z.object({
  items: z.array(matchSummarySchema),
  nextCursor: z.string().nullable(),
});

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export class SignedOut extends Error {}

export const profileSource: ProfileSource = {
  async fetchProfile() {
    try {
      return playerProfileSchema.parse(await getJson("/api/me"));
    } catch (error) {
      if (error instanceof SignedOut) return null;
      throw error;
    }
  },
};

export const statsApi: StatsApi = {
  async leaderboard(period) {
    return leaderboardSchema.parse(
      await getJson(`/api/leaderboard?period=${period}`),
    );
  },
  async matches(cursor) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return historyPageSchema.parse(await getJson(`/api/matches${query}`));
  },
};

const orderStatusSchema = z.object({
  status: z.enum(["paid", "failed", "pending"]),
  feature: z.string().nullable(),
});

export const shopApi: ShopApi = {
  startCheckout: (request) => startCheckout(request),
  async orderStatus(orderId) {
    try {
      return orderStatusSchema.parse(
        await getJson(`/api/orders/${encodeURIComponent(orderId)}`),
      );
    } catch {
      return null;
    }
  },
  equip: (change) => equipCosmetics(change),
  fetchProfile: () => profileSource.fetchProfile(),
};

const subscriptionsSchema = z.object({
  items: z
    .array(
      z.object({
        productKey: z.string(),
        state: z.enum([...subscriptionStates, "unknown"]),
        autoRenew: z.boolean(),
        paidUntil: z.string(),
        accessUntil: z.string(),
      }),
    )
    .nullable(),
});

/** The player's subscriptions (renewal, cancellation); null when unknown. */
export async function fetchSubscriptions(): Promise<
  SubscriptionSummary[] | null
> {
  try {
    return subscriptionsSchema.parse(await getJson("/api/subscriptions")).items;
  } catch {
    return null;
  }
}
