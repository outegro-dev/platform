import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CLOCK, type Clock } from "@outegro/nest-common";
import type { RoundTimings } from "@outegro/roulette-engine";
import { RouletteMetrics } from "../common/metrics.js";
import { FAIR_ROLL, ROUND_TIMINGS, WALLET } from "../common/tokens.js";
import { betRef } from "../domain/ids.js";
import type { FairRollPort } from "../fair/fair-roll.port.js";
import { TableSettingsService } from "../table/table.settings.js";
import type { WalletPort } from "../wallet/wallet.port.js";
import { RoundFeed, SnapshotService } from "./round.feed.js";
import { RoundRepository, type RoundRow } from "./round.repository.js";
import { RoundStore } from "./round.store.js";
import { SettlementService } from "./settlement.service.js";

/** How long the close waits for bets whose debit is still in flight. */
export const CLOSE_GRACE_MS = 800;
/** How often a table in maintenance looks whether it may open again. */
const MAINTENANCE_RECHECK_MS = 1000;
const GRACE_POLL_MS = 10;

/**
 * The round state machine (ADR-012): betting → locked → rolling → settled →
 * the next round. Only the leader runs it, one `step` at a time; each step
 * reads the record, makes the move that is due and says when to look again.
 * Moves are conditional on the recorded status, so a stale leader is harmless.
 */
@Injectable()
export class RoundEngine {
  private readonly logger = new Logger("RoundEngine");

  constructor(
    private readonly repo: RoundRepository,
    private readonly store: RoundStore,
    private readonly settlement: SettlementService,
    private readonly snapshots: SnapshotService,
    private readonly feed: RoundFeed,
    @Inject(FAIR_ROLL) private readonly fair: FairRollPort,
    @Inject(WALLET) private readonly wallet: WalletPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROUND_TIMINGS) private readonly timings: RoundTimings,
    private readonly metrics: RouletteMetrics,
    private readonly settings: TableSettingsService,
  ) {}

  /** One move; returns when the next one falls due (now: at once). */
  async step(): Promise<Date> {
    const now = this.clock.now();
    const round = await this.repo.latest();
    if (!round) {
      // A fresh database continues after whatever fair-roll already revealed.
      const { lastRevealed } = await this.fair.chain();
      await this.open(lastRevealed + 1, now);
      return this.clock.now();
    }
    switch (round.status) {
      case "betting":
        if (now < round.bettingEndsAt) {
          await this.store.ensureBetting(round.id);
          return round.bettingEndsAt;
        }
        await this.close(round);
        return this.clock.now();
      case "locked":
        await this.roll(round);
        return this.clock.now();
      case "rolling":
      case "paying":
        if (round.settleAt && now < round.settleAt) return round.settleAt;
        await this.settlement.settle(round);
        await this.publish();
        return this.clock.now();
      case "settled":
      case "voided":
        if (round.nextRoundAt && now < round.nextRoundAt)
          return round.nextRoundAt;
        // Maintenance: the round in play finishes, no new one opens.
        if ((await this.settings.current()).maintenance) {
          await this.publish();
          return new Date(now.getTime() + MAINTENANCE_RECHECK_MS);
        }
        await this.open(round.id + 1, now);
        return this.clock.now();
    }
  }

  /** Sends the current round to every instance (and so every socket). */
  async publish(): Promise<void> {
    const view = await this.snapshots.latest();
    if (view) await this.feed.publish(view);
  }

  private async open(id: number, now: Date) {
    if (await this.repo.open(id, now, this.timings)) {
      await this.store.open(id);
      this.logger.log({ round: id }, "Round opened");
    }
    await this.publish();
  }

  /**
   * Stops bets in Valkey, gives debits in flight up to 800 ms, then closes
   * the record. Bets still unfinished after that are rolled back in `roll`.
   */
  private async close(round: RoundRow) {
    await this.store.lock(round.id);
    await this.publish();
    const deadline = performance.now() + CLOSE_GRACE_MS;
    while (
      (await this.store.pendingCount(round.id)) > 0 &&
      performance.now() < deadline
    )
      await sleep(GRACE_POLL_MS);
    await this.repo.lock(round.id, this.clock.now());
  }

  /** Rolls back the stragglers, reveals the round's seed and starts the spin. */
  private async roll(round: RoundRow) {
    await this.rollBackStragglers(round.id);
    const reveal = await this.fair.reveal(round.id);
    const rollingAt = new Date(
      Math.max(
        this.clock.now().getTime(),
        round.bettingEndsAt.getTime() + this.timings.lockedMs,
      ),
    );
    if (await this.repo.startRolling(round.id, reveal, rollingAt, this.timings))
      this.logger.log(
        { round: round.id, number: reveal.number },
        "Round rolling",
      );
    await this.publish();
  }

  /**
   * Bets reserved but not in the record once it is closed never joined the
   * round: their debits are rolled back by ref. The wallet leaves a
   * tombstone where no debit arrived yet, so a late one fails with 409.
   */
  private async rollBackStragglers(roundId: number) {
    const pending = await this.store.pending(roundId);
    if (pending.length === 0) return;
    const recorded = await this.repo.existing(pending);
    const abandoned = pending.filter((betId) => !recorded.has(betId));
    await Promise.all(
      abandoned.map((betId) => this.wallet.rollback(betRef(betId))),
    );
    await this.store.dropPending(roundId, abandoned);
    this.metrics.closeRollbacks(abandoned.length);
    if (abandoned.length > 0)
      this.logger.warn(
        { round: roundId, bets: abandoned.length },
        "Unfinished debits rolled back at the close",
      );
  }
}
