import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import type { FairInfo, FairRound } from "@outegro/contracts/roulette";
import { AppError, Public } from "@outegro/nest-common";
import { colorOf } from "@outegro/roulette-engine";
import { z } from "zod";
import { FAIR_ROLL } from "../common/tokens.js";
import type { FairRollPort } from "../fair/fair-roll.port.js";
import { RoundRepository } from "./round.repository.js";

const historyQuerySchema = z.object({
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const roundParam = z.coerce.number().int().positive();

/**
 * Public read side for /fair and the history row: settled results, one
 * round with everything needed to check it, and the published chain.
 */
@Public()
@Controller()
export class RoundsController {
  constructor(
    private readonly repo: RoundRepository,
    @Inject(FAIR_ROLL) private readonly fair: FairRollPort,
  ) {}

  @Get("rounds")
  async history(
    @Query({ schema: historyQuerySchema }) query: z.infer<
      typeof historyQuerySchema
    >,
  ) {
    const rows = await this.repo.history(query.limit, query.cursor);
    const items = rows.flatMap((row) =>
      row.number !== null && row.color !== null
        ? [{ round: row.round, number: row.number, color: row.color }]
        : [],
    );
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        items.length === query.limit && last ? String(last.round) : null,
    };
  }

  @Get("rounds/:round")
  async round(@Param("round") raw: string): Promise<FairRound> {
    const parsed = roundParam.safeParse(raw);
    if (!parsed.success)
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { round: ["a round number from 1"] },
      });
    const round = await this.repo.find(parsed.data);
    if (!round) throw new AppError("NOT_FOUND");
    const chain = await this.fair.chain();
    const previous = round.id === 1 ? null : await this.repo.find(round.id - 1);
    const revealed = round.seed !== null && round.number !== null;
    return {
      round: round.id,
      phase: round.status === "paying" ? "rolling" : round.status,
      commit: chain.commit,
      publicSeed: chain.publicSeed,
      seed: revealed ? round.seed : null,
      number: revealed ? round.number : null,
      color: revealed && round.number !== null ? colorOf(round.number) : null,
      previousSeed: round.id === 1 ? chain.commit : (previous?.seed ?? null),
      bets: round.bets,
      staked: round.staked,
      paidOut: round.paidOut,
    };
  }

  @Get("fair")
  info(): Promise<FairInfo> {
    return this.fair.chain();
  }
}
