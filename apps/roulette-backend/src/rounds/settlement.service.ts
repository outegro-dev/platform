import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK, type Clock } from "@outegro/nest-common";
import {
  colorOf,
  multipliers,
  type RoundTimings,
} from "@outegro/roulette-engine";
import { RouletteMetrics } from "../common/metrics.js";
import { ROUND_TIMINGS, WALLET } from "../common/tokens.js";
import { winRef } from "../domain/ids.js";
import {
  CREDIT_BATCH_LIMIT,
  type CreditItem,
  type WalletPort,
} from "../wallet/wallet.port.js";
import { RoundRepository, type RoundRow } from "./round.repository.js";

/**
 * Pays a round out (ADR-012): winnings go to the wallet in batches of up to
 * 1 000 with `ref = roulette:win:{betId}`, then one transaction marks the
 * bets and closes the round. A repeat after a crash pays nothing twice: the
 * wallet answers "duplicate" for every ref it has seen.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger("Settlement");

  constructor(
    private readonly repo: RoundRepository,
    @Inject(WALLET) private readonly wallet: WalletPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROUND_TIMINGS) private readonly timings: RoundTimings,
    private readonly metrics: RouletteMetrics,
  ) {}

  /** True when this call closed the round. */
  async settle(round: RoundRow): Promise<boolean> {
    if (round.number === null)
      throw new Error(`round ${round.id} has no number to settle`);
    const started = performance.now();
    const color = colorOf(round.number);
    const winners: CreditItem[] = (await this.repo.betsOf(round.id))
      .filter((bet) => bet.color === color)
      .map((bet) => ({
        userId: bet.userId,
        amount: bet.amount * multipliers[color],
        ref: winRef(bet.id),
        meta: { game: "roulette", round: round.id, color },
      }));
    for (let i = 0; i < winners.length; i += CREDIT_BATCH_LIMIT)
      await this.wallet.creditBatch(winners.slice(i, i + CREDIT_BATCH_LIMIT));
    const closed = await this.repo.settle(
      round.id,
      color,
      this.clock.now(),
      this.timings,
    );
    if (closed) {
      this.metrics.roundSettled((performance.now() - started) / 1000);
      this.logger.log(
        { round: round.id, number: round.number, winners: winners.length },
        "Round settled",
      );
    }
    return closed;
  }
}
