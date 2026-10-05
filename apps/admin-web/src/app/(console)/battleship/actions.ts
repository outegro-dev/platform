"use server";

import { adminReasonSchema } from "@outegro/contracts";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";

const uuid = z.uuid();

/** Stops a live match without a winner; ratings stay as they were. */
export async function abortMatch(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "battleship.moderate",
    form,
    schema: z.object({ matchId: uuid, reason: adminReasonSchema }),
    run: (services, input) =>
      services.battleship.abort(input.matchId, input.reason),
    success: (t) => t("done.matchAborted"),
    explain: (error) => (error.error.code === "CONFLICT" ? "not-live" : null),
  });
}

export async function resetNickname(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  let nickname = "";
  return runAction({
    permission: "battleship.moderate",
    form,
    schema: z.object({ userId: uuid, reason: adminReasonSchema }),
    run: async (services, input) => {
      nickname = await services.battleship.resetNickname(
        input.userId,
        input.reason,
      );
    },
    success: (t) =>
      nickname
        ? t("done.nicknameResetTo", { nickname })
        : t("done.nicknameReset"),
  });
}

export async function setLeaderboardVisibility(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return runAction({
    permission: "battleship.moderate",
    form,
    schema: z.object({
      userId: uuid,
      hidden: z.enum(["true", "false"]),
      reason: adminReasonSchema,
    }),
    run: (services, input) =>
      services.battleship.setLeaderboardHidden(
        input.userId,
        input.hidden === "true",
        input.reason,
      ),
    success: (t, input) =>
      t(input.hidden === "true" ? "done.playerHidden" : "done.playerShown"),
  });
}
