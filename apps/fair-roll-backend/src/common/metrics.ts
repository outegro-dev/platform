import { Injectable } from "@nestjs/common";
import { type Counter, type Gauge, Metrics } from "@outegro/nest-common";

export type RevealResult = "revealed" | "repeat" | "out_of_order" | "exhausted";

/** fair-roll metrics: reveals by outcome and how far the chain is spent. */
@Injectable()
export class FairRollMetrics {
  private readonly reveals: Counter<"result">;
  private readonly last: Gauge;

  constructor(metrics: Metrics) {
    this.reveals = metrics.counter({
      name: "fair_roll_reveals_total",
      help: "Reveal requests by result: revealed, repeat (the last round again), out_of_order (409), exhausted (past the chain).",
      labelNames: ["result"],
    });
    this.last = metrics.gauge({
      name: "fair_roll_last_revealed_round",
      help: "The last revealed round of the current chain.",
    });
  }

  reveal(result: RevealResult) {
    this.reveals.inc({ result });
  }

  lastRevealed(round: number) {
    this.last.set(round);
  }
}
