import { Controller, Get, Param, Query } from "@nestjs/common";
import { type PageQuery, pageQuerySchema } from "@outegro/contracts";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import { StatsService } from "./stats.service.js";

@Controller()
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Heatmap is Premium; without it the field is null. */
  @Get("me/stats")
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.stats.stats(user.userId);
  }

  @Get("me/matches")
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query({ schema: pageQuerySchema }) query: PageQuery,
  ) {
    return this.stats.history(user.userId, query);
  }

  /** Premium (403 otherwise); only the player's own finished matches (404 otherwise). */
  @Get("matches/:id/replay")
  replay(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.stats.replay(user.userId, id);
  }
}
