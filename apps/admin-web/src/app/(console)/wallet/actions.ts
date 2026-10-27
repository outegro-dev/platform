"use server";

import { adminReasonSchema, amountSchema } from "@outegro/contracts/wallet";
import { z } from "zod";
import { type ActionResult, runAction } from "@/lib/actions";

const commandSchema = z.object({
  userId: z.uuid(),
  /** One per rendered form: sending it again applies it once. */
  commandId: z.uuid(),
  amount: amountSchema,
  reason: adminReasonSchema,
});

function walletCommand(kind: "grant" | "adjust") {
  return (form: FormData) =>
    runAction({
      permission: "wallet.adjust",
      form,
      schema: commandSchema,
      run: async (services, input) => {
        await services.wallet.command(kind, input.userId, {
          amount: input.amount,
          reason: input.reason,
          commandId: input.commandId,
        });
      },
      success: (t, input) =>
        t(kind === "grant" ? "done.grumblesGranted" : "done.grumblesTaken", {
          count: Number(input.amount),
        }),
      explain: (error) => {
        if (error.error.code === "INSUFFICIENT_FUNDS")
          return "insufficient-funds";
        if (error.error.fieldErrors.amount?.includes("too_large"))
          return "amount-too-large";
        return null;
      },
    });
}

/** Adds grumbles to a wallet: a bonus, a promo or compensation. */
export async function grantGrumbles(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return walletCommand("grant")(form);
}

/** Takes grumbles from a wallet; never below zero. */
export async function takeGrumbles(
  _: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  return walletCommand("adjust")(form);
}
