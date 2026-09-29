"use server";

import { BackendError } from "@outegro/bff/backend";
import {
  type Cosmetics,
  cosmeticsSchema,
  nicknameSchema,
  type PlayerProfile,
  playerProfileSchema,
} from "@outegro/contracts/battleship";
import { z } from "zod";
import type { EquipResult } from "@/game/stores/shop-store";
import { accessToken, battleshipApi, payments } from "@/lib/api";
import {
  type CheckoutOutcome,
  type CheckoutRequest,
  checkoutReferencePattern,
  currencies,
} from "@/lib/catalog";

export type NicknameState = {
  status: "idle" | "saved" | "invalid" | "taken" | "unavailable" | "signed-out";
  /** What was submitted, so the field keeps it after an error. */
  value?: string;
  profile?: PlayerProfile;
};

/** Renames the player in the game (not in Identity); 409 means taken. */
export async function updateNickname(
  _: NicknameState,
  form: FormData,
): Promise<NicknameState> {
  const value = String(form.get("nickname") ?? "").slice(0, 64);
  const parsed = nicknameSchema.safeParse(value);
  if (!parsed.success) return { status: "invalid", value };
  const token = await accessToken();
  if (!token) return { status: "signed-out", value };
  try {
    const raw = await battleshipApi<unknown>("/v1/me", {
      method: "PATCH",
      accessToken: token,
      body: { nickname: parsed.data },
    });
    return {
      status: "saved",
      value: parsed.data,
      profile: playerProfileSchema.parse(raw),
    };
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.status === 409) return { status: "taken", value };
      if (error.status === 401) return { status: "signed-out", value };
      if (error.status === 400 || error.status === 422)
        return { status: "invalid", value };
    }
    return { status: "unavailable", value };
  }
}

/** Equips cosmetics; the server refuses items that are not unlocked (403). */
export async function equipCosmetics(
  change: Partial<Cosmetics>,
): Promise<EquipResult> {
  const parsed = cosmeticsSchema.partial().safeParse(change);
  if (!parsed.success || Object.keys(parsed.data).length === 0)
    return { ok: false, reason: "locked" };
  const token = await accessToken();
  if (!token) return { ok: false, reason: "unauthorized" };
  try {
    const raw = await battleshipApi<unknown>("/v1/me", {
      method: "PATCH",
      accessToken: token,
      body: { cosmetics: parsed.data },
    });
    return { ok: true, profile: playerProfileSchema.parse(raw) };
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.status === 401) return { ok: false, reason: "unauthorized" };
      if (error.status === 403 || error.status === 422)
        return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "unavailable" };
  }
}

const checkoutInput = z
  .object({
    productKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    currency: z.enum(currencies),
    reference: z.string().regex(checkoutReferencePattern),
  })
  .strict();

/**
 * Starts a checkout, or re-reads it with the same reference while the
 * payment page is being prepared. The redirect target is checked here.
 */
export async function startCheckout(
  request: CheckoutRequest,
): Promise<CheckoutOutcome> {
  const input = checkoutInput.safeParse(request);
  if (!input.success) return { kind: "error", reason: "rejected" };
  const token = await accessToken();
  if (!token) return { kind: "error", reason: "unauthorized" };
  return payments.checkout({ ...input.data, accessToken: token });
}
