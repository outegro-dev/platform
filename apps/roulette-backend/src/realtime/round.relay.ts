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
    const bettors = this.registry.takeBetsOf(view.round);
    if (bettors.size === 0) return;
    // One read for every bettor on this replica; without it the client keeps its figure.
    const balances = await this.wallet
      .balances([...bettors.keys()])
      .catch(() => new Map<string, number>());
    for (const [userId, bets] of bettors) {
      const payout = bets.reduce((sum, bet) => sum + payoutOf(bet, number), 0);
      this.registry.send(userId, {
        type: "balance",
        payload: {
          balance: balances.get(userId) ?? null,
          round: view.round,
          payout,
        },
      });
    }
  }
}
