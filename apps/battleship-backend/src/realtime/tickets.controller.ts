import { Controller, Post } from "@nestjs/common";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import { PlayersService } from "../players/players.service.js";
import { TicketStore } from "./ticket.store.js";

/** The BFF trades the user's access token for a socket ticket. */
@Controller("ws-tickets")
export class TicketsController {
  constructor(
    private readonly tickets: TicketStore,
    private readonly players: PlayersService,
  ) {}

  @Post()
  async issue(@CurrentUser() user: AuthenticatedUser) {
    await this.players.requireActive(user.userId);
    return this.tickets.issue(user.userId);
  }
}
