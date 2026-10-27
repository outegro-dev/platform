import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { RoundView } from "@outegro/contracts/roulette";
import { payoutOf } from "@outegro/roulette-engine";
import { WALLET } from "../common/tokens.js";
import { RoundFeed } from "../rounds/round.feed.js";
import type { WalletPort } from "../wallet/wallet.port.js";
import { ConnectionRegistry } from "./connection.registry.js";

/**
 * Hands every round frame to this instance's sockets, and once a round is
 * settled tells each player who bet in it what it paid and the new balance.
 */
@Injectable()
export class RoundRelay implements OnApplicationBootstrap {
  private readonly logger = new Logger("RoundRelay");

  constructor(
    private readonly feed: RoundFeed,
    private readonly registry: ConnectionRegistry,
    @Inject(WALLET) private readonly wallet: WalletPort,
  ) {}

  onApplicationBootstrap() {
    this.feed.listen((frame, view) => {
      this.registry.broadcast(frame);
      if (view.phase === "settled" && view.result)
        this.payouts(view).catch((error: unknown) =>
          this.logger.warn(
            { round: view.round, err: (error as Error).message },
            "Payout notices failed",
          ),
        );
    });
  }

  private async payouts(view: RoundView) {
    const number = view.result?.number;
    if (number === undefined) return;
    for (const [userId, bets] of this.registry.takeBetsOf(view.round)) {
      const payout = bets.reduce((sum, bet) => sum + payoutOf(bet, number), 0);
      const balance = await this.wallet.balance(userId);
      this.registry.send(userId, {
        type: "balance",
        payload: { balance, round: view.round, payout },
      });
    }
  }
}
