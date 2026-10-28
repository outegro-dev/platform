import { Injectable } from "@nestjs/common";
import { type Counter, Metrics } from "@outegro/nest-common";

/** Daily bonus metrics: claims by outcome and the grumbles handed out. */
@Injectable()
export class DailyMetrics {
  private readonly claims: Counter<"result">;
  private readonly grumbles: Counter;

  constructor(metrics: Metrics) {
    this.claims = metrics.counter({
      name: "daily_bonus_claims_total",
      help: "Bonus claims by result: granted, or why not (disabled, email_unverified, account_too_new, account_closed, ip_limit, device_limit, wallet_unavailable).",
      labelNames: ["result"],
    });
    this.grumbles = metrics.counter({
      name: "daily_bonus_granted_grumbles_total",
      help: "Grumbles credited as daily bonuses, streak bonuses included.",
    });
  }

  claim(result: string) {
    this.claims.inc({ result });
  }

  granted(amount: number) {
    this.grumbles.inc(amount);
  }
}
