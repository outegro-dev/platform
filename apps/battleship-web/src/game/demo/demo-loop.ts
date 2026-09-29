import { makeAutoObservable } from "mobx";
import { realTimers, type Timers } from "../transport/timers";
import {
  type DemoBeat,
  type DemoFrame,
  demoBeats,
  demoFrame,
} from "./demo-script";

/** How long the first still picture stays before the first round. */
const FIRST_HOLD_MS = 1200;

/**
 * Plays the home page battle, one timer per beat (a few per second, no
 * per-frame work). It plays only while it is started, on screen, in a
 * visible tab and motion is welcome. Off screen or hidden it pauses where
 * it is; without motion it rests on the full still picture (beat 0).
 */
export class DemoLoop {
  beat = 0;
  /** Counts rounds, so a new round's effects start afresh. */
  round = 0;
  onScreen = false;
  pageVisible = true;
  motion = false;
  private started = false;
  private firstHold = true;
  private timer: unknown = null;

  constructor(
    private readonly timers: Timers = realTimers,
    private readonly beats: readonly DemoBeat[] = demoBeats,
  ) {
    makeAutoObservable<DemoLoop, "timers" | "beats" | "timer" | "firstHold">(
      this,
      {
        timers: false,
        beats: false,
        timer: false,
        firstHold: false,
      },
      { autoBind: true },
    );
  }

  get playing(): boolean {
    return this.started && this.onScreen && this.pageVisible && this.motion;
  }

  /** Stopped mid-round (off screen, hidden tab): running effects hold too. */
  get paused(): boolean {
    return this.started && this.motion && !this.playing;
  }

  get frame(): DemoFrame {
    return demoFrame(this.beat);
  }

  start(): void {
    this.started = true;
    this.sync();
  }

  dispose(): void {
    this.started = false;
    this.sync();
  }

  setOnScreen(onScreen: boolean): void {
    this.onScreen = onScreen;
    this.sync();
  }

  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    this.sync();
  }

  /** Reduced motion turns it off: back to the still picture. */
  setMotion(allowed: boolean): void {
    this.motion = allowed;
    if (!allowed) this.beat = 0;
    this.sync();
  }

  /** Moves to the next beat (the timer calls it). */
  private advance(): void {
    this.firstHold = false;
    this.beat = (this.beat + 1) % this.beats.length;
    if (this.beat === 1) this.round++;
    this.stopTimer();
    this.sync();
  }

  private sync(): void {
    if (!this.playing) {
      this.stopTimer();
      return;
    }
    if (this.timer !== null) return;
    const ms =
      this.beat === 0 && this.firstHold
        ? FIRST_HOLD_MS
        : (this.beats[this.beat]?.ms ?? 0);
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.advance();
    }, ms);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}
