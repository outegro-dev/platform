import { z } from "zod";
import {
  botLevelSchema,
  finishReasonSchema,
  matchModeSchema,
} from "../battleship.js";
import { defineEvent } from "../envelope.js";
import { isoDateTime } from "../primitives.js";

/** A match ended; for future notifications and analytics. Ids only. */
export const battleshipMatchFinished = defineEvent(
  "battleship.match.finished.v1",
  "battleship",
  z.object({
    matchId: z.uuid(),
    mode: matchModeSchema,
    /** null when a bot won or lost. */
    winnerUserId: z.uuid().nullable(),
    loserUserId: z.uuid().nullable(),
    botLevel: botLevelSchema.nullable(),
    reason: finishReasonSchema,
    moves: z.number().int().nonnegative(),
    rated: z.boolean(),
    /** Rating points the winner gained (the loser lost the same); null if unrated. */
    ratingDelta: z.number().int().positive().nullable(),
    finishedAt: isoDateTime,
  }),
);
