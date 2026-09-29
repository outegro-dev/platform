import { makeAutoObservable } from "mobx";
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_MS,
  KEEPALIVE_INTERVAL_MS,
} from "@/lib/idle";

export type IdleEffects = {
  /** Tell the server the operator is still here (updates og_admin_seen). */
  keepalive: () => void;
  /** Sign out for inactivity (POST /auth/sign-out with reason=idle). */
  signOut: () => void;
  /** Share activity with the console's other tabs. */
  broadcast: (at: number) => void;
};

export type IdleOptions = {
  timeoutMs: number;
  warningMs: number;
  keepaliveMs: number;
  /** Activity closer than this to the last one is not re-recorded. */
  throttleMs: number;
};

const defaults: IdleOptions = {
  timeoutMs: IDLE_TIMEOUT_MS,
  warningMs: IDLE_WARNING_MS,
  keepaliveMs: KEEPALIVE_INTERVAL_MS,
  throttleMs: 5000,
};

/**
 * Idle sign-out for the whole console: activity in any tab resets the
 * timer, a warning with a countdown opens two minutes before the end, and
 * only an explicit "Stay signed in" dismisses it (WCAG 2.2.1).
 */
export class IdleSessionStore {
  lastActivity: number;
  now: number;
  signedOut = false;
  private lastKeepalive: number;
  private readonly options: IdleOptions;

  constructor(
    private readonly effects: IdleEffects,
    start: number,
    options: Partial<IdleOptions> = {},
  ) {
    this.options = { ...defaults, ...options };
    this.lastActivity = start;
    this.now = start;
    this.lastKeepalive = start;
    makeAutoObservable<
      IdleSessionStore,
      "effects" | "options" | "lastKeepalive"
    >(this, { effects: false, options: false, lastKeepalive: false });
  }

  get remainingMs(): number {
    return Math.max(0, this.lastActivity + this.options.timeoutMs - this.now);
  }

  get warning(): boolean {
    return !this.signedOut && this.remainingMs <= this.options.warningMs;
  }

  /** Whole seconds left, for the countdown ("1:43"). */
  get secondsLeft(): number {
    return Math.ceil(this.remainingMs / 1000);
  }

  /** Pointer, key, scroll or touch in this tab. Ignored while warning. */
  activity(at: number): void {
    if (this.signedOut || this.warning) return;
    if (at - this.lastActivity < this.options.throttleMs) return;
    this.record(at);
    this.effects.broadcast(at);
  }

  /** Activity reported by another tab of the console. */
  remoteActivity(at: number): void {
    if (this.signedOut || at <= this.lastActivity) return;
    this.lastActivity = at;
  }

  /** "Stay signed in" in the warning. */
  extend(at: number): void {
    if (this.signedOut) return;
    this.lastActivity = at;
    this.now = at;
    this.lastKeepalive = at;
    this.effects.keepalive();
    this.effects.broadcast(at);
  }

  tick(at: number): void {
    this.now = at;
    if (!this.signedOut && this.remainingMs === 0) {
      this.signedOut = true;
      this.effects.signOut();
    }
  }

  private record(at: number): void {
    this.lastActivity = at;
    if (at - this.lastKeepalive >= this.options.keepaliveMs) {
      this.lastKeepalive = at;
      this.effects.keepalive();
    }
  }
}
