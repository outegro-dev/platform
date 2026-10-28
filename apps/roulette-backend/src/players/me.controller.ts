import { Controller, Get, Inject } from "@nestjs/common";
import { type RouletteMe, rouletteUnit } from "@outegro/contracts/roulette";
import { type AuthenticatedUser, CurrentUser } from "@outegro/nest-common";
import { WALLET } from "../common/tokens.js";
import { balanceOrNull, type WalletPort } from "../wallet/wallet.port.js";
import { PlayersService } from "./players.service.js";

/** The signed-in player: roulette nickname and grumbles; ownership comes from the token. */
@Controller("me")
export class MeController {
  constructor(
    private readonly players: PlayersService,
    @Inject(WALLET) private readonly wallet: WalletPort,
  ) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<RouletteMe> {
    const player = await this.players.ensure(user.userId);
    return {
      userId: player.userId,
      nickname: player.nickname,
      balance: await balanceOrNull(this.wallet, user.userId),
      unit: rouletteUnit,
    };
  }
}
