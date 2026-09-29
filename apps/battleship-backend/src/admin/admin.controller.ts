import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  type AuthenticatedUser,
  CurrentUser,
  RequirePermissions,
} from "@outegro/nest-common";
import { z } from "zod";
import {
  AdminService,
  auditListSchema,
  matchListSchema,
  playerSearchSchema,
} from "./admin.service.js";

const reason = z.string().trim().min(3).max(500);
const reasonSchema = z.object({ reason });
const visibilitySchema = z.object({ hidden: z.boolean(), reason });

/**
 * Admin console API (`battleship.read` to look, `battleship.moderate` to act).
 * Every moderation command carries a reason and is audited.
 */
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  @RequirePermissions("battleship.read")
  overview() {
    return this.admin.overview();
  }

  @Get("matches")
  @RequirePermissions("battleship.read")
  matches(
    @Query({ schema: matchListSchema }) query: z.infer<typeof matchListSchema>,
  ) {
    return this.admin.listMatches(query);
  }

  @Get("matches/:id")
  @RequirePermissions("battleship.read")
  match(@Param("id") id: string) {
    return this.admin.matchDetail(id);
  }

  @Post("matches/:id/abort")
  @HttpCode(200)
  @RequirePermissions("battleship.moderate")
  abort(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: reasonSchema }) body: z.infer<typeof reasonSchema>,
  ) {
    return this.admin.abortMatch(actor, id, body.reason);
  }

  @Get("players")
  @RequirePermissions("battleship.read")
  players(
    @Query({ schema: playerSearchSchema }) query: z.infer<
      typeof playerSearchSchema
    >,
  ) {
    return this.admin.searchPlayers(query);
  }

  @Get("players/:id")
  @RequirePermissions("battleship.read")
  player(@Param("id") id: string) {
    return this.admin.playerDetail(id);
  }

  @Post("players/:id/reset-nickname")
  @HttpCode(200)
  @RequirePermissions("battleship.moderate")
  resetNickname(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: reasonSchema }) body: z.infer<typeof reasonSchema>,
  ) {
    return this.admin.resetNickname(actor, id, body.reason);
  }

  @Post("players/:id/leaderboard")
  @HttpCode(200)
  @RequirePermissions("battleship.moderate")
  leaderboard(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id") id: string,
    @Body({ schema: visibilitySchema }) body: z.infer<typeof visibilitySchema>,
  ) {
    return this.admin.setLeaderboardHidden(actor, id, body.hidden, body.reason);
  }

  @Get("audit")
  @RequirePermissions("battleship.read")
  audit(
    @Query({ schema: auditListSchema }) query: z.infer<typeof auditListSchema>,
  ) {
    return this.admin.listAudit(query);
  }
}
