import { Controller, Get, Query, Req } from "@nestjs/common";
import {
  type Leaderboard,
  leaderboardPeriodSchema,
} from "@outegro/contracts/battleship";
import { AccessTokenVerifier, AppError, Public } from "@outegro/nest-common";
import type { Request } from "express";
import { z } from "zod";
import { LeaderboardService } from "./leaderboard.service.js";

const querySchema = z.object({
  period: leaderboardPeriodSchema.default("all"),
});

/** Public; with a valid token the caller's own place is included (`you`). */
@Public()
@Controller("leaderboard")
export class LeaderboardController {
  constructor(
    private readonly leaderboard: LeaderboardService,
    private readonly verifier: AccessTokenVerifier,
  ) {}

  @Get()
  async board(
    @Query({ schema: querySchema }) query: z.infer<typeof querySchema>,
    @Req() request: Request,
  ): Promise<Leaderboard> {
    return this.leaderboard.board(query.period, await this.viewer(request));
  }

  /** Optional auth: no header is anonymous, a bad token is 401 (the BFF refreshes). */
  private async viewer(request: Request): Promise<string | null> {
    const header = request.headers.authorization;
    if (!header) return null;
    if (!header.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED");
    return (await this.verifier.verify(header.slice(7).trim())).userId;
  }
}
