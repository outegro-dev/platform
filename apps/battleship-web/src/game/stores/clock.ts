import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved } from "mobx";
import { realTimers, type Timers } from "../transport/timers";

/**
 * Server-aligned time for countdowns. `now` ticks only while something
 * observes it (a visible timer), and deadlines from the server are compared
 * with local time corrected by the offset measured at `session.ready`.
 */
export class Clock {
  /** Local epoch ms; ticks while observed. */
  now: number;
  /** Server time minus local time. */
  offsetMs = 0;
  private timer: unknown = null;

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly tickMs = 250,
  ) {
    this.now = timers.now();
    makeAutoObservable<Clock, "timer" | "timers" | "tickMs">(
      this,
      {
        timer: false,
        timers: false,
        tickMs: false,
        msUntil: false,
        msSince: false,
      },
      { autoBind: true },
    );
    onBecomeObserved(this, "now", () => this.startTicking());
    onBecomeUnobserved(this, "now", () => this.stopTicking());
  }

  /** Aligns with the server clock from `session.ready.serverTime`. */
  sync(serverTime: string): void {
    const server = Date.parse(serverTime);
    if (Number.isNaN(server)) return;
    this.now = this.timers.now();
    this.offsetMs = server - this.now;
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

  /** Milliseconds since a server epoch ms (e.g. queue start). */
  msSince(epochMs: number | null): number | null {
    if (epochMs === null) return null;
    return Math.max(0, this.serverNow - epochMs);
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
