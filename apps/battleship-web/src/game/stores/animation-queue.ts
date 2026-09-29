import { action, makeObservable, observable } from "mobx";
import { realTimers, type Timers } from "../transport/timers";

export type AnimationStep = {
  /** How long the step's animation plays before the next step may start. */
  duration: number;
  /** Applies the step's state change (runs inside a MobX action). */
  run: () => void;
};

/**
 * Plays server events one after another. Each step applies its change when
 * it starts and holds the queue for its animation, so a bot's three quick
 * shots land as three visible shots, in order. The server stays the source
 * of truth: nothing is predicted, only paced.
 */
export class AnimationQueue {
  busy = false;
  private readonly steps: AnimationStep[] = [];
  private timer: unknown = null;

  constructor(private readonly timers: Timers = realTimers) {
    makeObservable<AnimationQueue, "advance">(this, {
      busy: observable,
      push: action,
      flush: action,
      clear: action,
      advance: action,
    });
  }

  get pending(): number {
    return this.steps.length;
  }

  push(step: AnimationStep): void {
    this.steps.push(step);
    if (this.timer === null && !this.busy) this.advance();
  }

  /** Applies every waiting step now (a snapshot arrived, the tab is hidden). */
  flush(): void {
    this.stopTimer();
    for (let step = this.steps.shift(); step; step = this.steps.shift()) {
      step.run();
    }
    this.busy = false;
  }

  /** Drops waiting steps without applying them (a snapshot supersedes them). */
  clear(): void {
    this.stopTimer();
    this.steps.length = 0;
    this.busy = false;
  }

  private advance(): void {
    // Zero-length steps run back to back without recursion.
    for (;;) {
      const step = this.steps.shift();
      if (!step) {
        this.busy = false;
        return;
      }
      this.busy = true;
      step.run();
      if (step.duration > 0) {
        this.timer = this.timers.setTimeout(() => {
          this.timer = null;
          this.advance();
        }, step.duration);
        return;
      }
    }
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
