import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved } from "mobx";
import { realTimers, type Timers } from "../transport/timers";

/**
 * Server-aligned time for the phase bar and the strip. `now` ticks only
 * while something observes it; deadlines from the server are compared with
 * local time corrected by the offset, which the welcome sets roughly and
 * every pong refines (half the round trip is the way back).
 */
export class Clock {
  /** Local epoch ms; ticks while observed. */
  now: number;
  /** Server time minus local time. */
  offsetMs = 0;
  /** Round trip of the pong the offset came from (Infinity before any). */
  private bestRtt = Number.POSITIVE_INFINITY;
  private timer: unknown = null;

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly tickMs = 100,
  ) {
    this.now = timers.now();
    makeAutoObservable<Clock, "timer" | "timers" | "tickMs" | "bestRtt">(
      this,
      {
        timer: false,
        timers: false,
        tickMs: false,
        bestRtt: false,
        msUntil: false,
      },
      { autoBind: true },
    );
    onBecomeObserved(this, "now", () => this.startTicking());
    onBecomeUnobserved(this, "now", () => this.stopTicking());
  }

  /** Rough alignment from `session.ready.serverTime`. */
  sync(serverTime: string): void {
    const server = Date.parse(serverTime);
    if (Number.isNaN(server)) return;
    this.now = this.timers.now();
    this.offsetMs = server - this.now;
    this.bestRtt = Number.POSITIVE_INFINITY;
  }

  /**
   * A pong answered at `serverTime`, sent at local `t`, back at local
   * `receivedAt`. The fastest round trip seen gives the best estimate.
   */
  syncPong(t: number, serverTime: string, receivedAt: number): void {
    const server = Date.parse(serverTime);
    const rtt = receivedAt - t;
    if (Number.isNaN(server) || rtt < 0 || rtt > this.bestRtt) return;
    this.bestRtt = rtt;
    this.offsetMs = server - (t + rtt / 2);
  }

  tick(): void {
    this.now = this.timers.now();
  }

  get serverNow(): number {
    return this.now + this.offsetMs;
  }

  /** Milliseconds left until an ISO deadline (0 once passed), null without one. */
  msUntil(deadline: string | null | undefined): number | null {
    if (!deadline) return null;
    const at = Date.parse(deadline);
    if (Number.isNaN(at)) return null;
    return Math.max(0, at - this.serverNow);
  }

  private startTicking(): void {
    this.tick();
    if (this.timer === null)
      this.timer = this.timers.setInterval(() => this.tick(), this.tickMs);
  }

  private stopTicking(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }
}
