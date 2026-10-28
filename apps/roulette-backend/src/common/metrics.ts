import { Injectable } from "@nestjs/common";
import { roulettePhaseSchema } from "@outegro/contracts/roulette";
import {
  type Counter,
  type Gauge,
  type Histogram,
  Metrics,
} from "@outegro/nest-common";

/** Roulette metrics: bets by outcome, the bet path latency, rounds and sockets. */
@Injectable()
export class RouletteMetrics {
  private readonly bets: Counter<"result">;
  private readonly betSeconds: Histogram;
  private readonly settled: Counter;
  private readonly settleSeconds: Histogram;
  private readonly rolledBack: Counter;
  private readonly phase: Gauge<"phase">;
  private readonly leader: Gauge;
  private readonly refused: Counter<"status">;
  private sockets = 0;

  constructor(metrics: Metrics) {
    this.bets = metrics.counter({
      name: "roulette_bets_total",
      help: "Bets by result: accepted, or the refusal code (round_closed, insufficient_funds, table_limit…).",
      labelNames: ["result"],
    });
    this.betSeconds = metrics.histogram({
      name: "roulette_bet_duration_seconds",
      help: "From a bet message to its answer: reserve, wallet debit, batched commit.",
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    });
    this.settled = metrics.counter({
      name: "roulette_rounds_settled_total",
      help: "Rounds this instance settled as the engine leader.",
    });
    this.settleSeconds = metrics.histogram({
      name: "roulette_settlement_duration_seconds",
      help: "Paying out one round: credit batches and the closing transaction.",
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    this.rolledBack = metrics.counter({
      name: "roulette_close_rollbacks_total",
      help: "Debits rolled back at the close because they had not finished in the 800 ms grace.",
    });
    this.phase = metrics.gauge({
      name: "roulette_round_phase",
      help: "1 for the phase the current round is in (this instance's view).",
      labelNames: ["phase"],
    });
    this.leader = metrics.gauge({
      name: "roulette_engine_leader",
      help: "1 when this instance drives the rounds.",
    });
    this.refused = metrics.counter({
      name: "roulette_socket_upgrades_refused_total",
      help: "Refused /ws upgrades by HTTP status: 401 ticket, 403 origin or account, 404 path, 429 sockets per player, 503 stopping or failure.",
      labelNames: ["status"],
    });
    const self = this;
    metrics.gauge({
      name: "roulette_game_sockets",
      help: "Open game sockets (/ws) in this process.",
      collect() {
        this.set(self.sockets);
      },
    });
  }

  bet(result: string, seconds: number) {
    this.bets.inc({ result });
    this.betSeconds.observe(seconds);
  }

  roundSettled(seconds: number) {
    this.settled.inc();
    this.settleSeconds.observe(seconds);
  }

  closeRollbacks(count: number) {
    if (count > 0) this.rolledBack.inc(count);
  }

  phaseIs(current: string) {
    for (const phase of roulettePhaseSchema.options)
      this.phase.set({ phase }, phase === current ? 1 : 0);
  }

  isLeader(leader: boolean) {
    this.leader.set(leader ? 1 : 0);
  }

  upgradeRefused(status: number) {
    this.refused.inc({ status: String(status) });
  }

  socketsOpen(count: number) {
    this.sockets = count;
  }
}
