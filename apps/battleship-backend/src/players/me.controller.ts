import { Body, Controller, Get, Patch } from "@nestjs/common";
import {
  type PlayerProfile,
  updateProfileSchema,
} from "@outegro/contracts/battleship";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import type { z } from "zod";
import { PlayersService } from "./players.service.js";

/** The signed-in player's own profile; ownership comes from the token. */
@Controller("me")
export class MeController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  me(@CurrentUser() user: AuthenticatedUser): Promise<PlayerProfile> {
    return this.players.profile(user.userId);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body({ schema: updateProfileSchema }) body: z.infer<
      typeof updateProfileSchema
    >,
  ): Promise<PlayerProfile> {
    return this.players.update(user.userId, body);
  }
}
