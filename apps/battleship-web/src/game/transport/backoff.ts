export type BackoffOptions = {
  minMs: number;
  maxMs: number;
  factor: number;
  /** Share of the delay randomised in both directions (0.3 = ±30%). */
  jitter: number;
};

export const reconnectBackoff: BackoffOptions = {
  minMs: 500,
  maxMs: 10_000,
  factor: 2,
  jitter: 0.3,
};

/**
 * Exponential backoff with jitter, clamped to [minMs, maxMs]: 0.5 s, 1 s,
 * 2 s … 10 s. Jitter keeps many tabs from reconnecting in lockstep after an
 * outage.
 */
export class Backoff {
  private attempt = 0;

  constructor(
    private readonly options: BackoffOptions = reconnectBackoff,
    private readonly random: () => number = Math.random,
  ) {}

  /** Delay before the next attempt; each call counts as one attempt. */
  next(): number {
    const { minMs, maxMs, factor, jitter } = this.options;
    const base = Math.min(maxMs, minMs * factor ** this.attempt);
    this.attempt++;
    const spread = base * jitter;
    const delay = base - spread + this.random() * spread * 2;
    return Math.round(Math.min(maxMs, Math.max(minMs, delay)));
  }

  reset(): void {
    this.attempt = 0;
  }

  get attempts(): number {
    return this.attempt;
  }
}
