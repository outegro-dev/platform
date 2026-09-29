import type { Clock } from "./ports.js";

/**
 * Per-connection command budget: `ratePerSecond` tokens refill continuously
 * up to `burst`; each command takes one.
 */
export class TokenBucket {
  private tokens: number;
  private refilledAt: number;

  constructor(
    private readonly clock: Clock,
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.refilledAt = clock.now().getTime();
  }

  /** Takes a token; false when the budget is spent. */
  take(): boolean {
    const now = this.clock.now().getTime();
    const elapsed = Math.max(0, now - this.refilledAt);
    this.tokens = Math.min(
      this.burst,
      this.tokens + (elapsed / 1000) * this.ratePerSecond,
    );
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
