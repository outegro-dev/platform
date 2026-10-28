import type { AdminLive } from "@outegro/contracts/roulette";
import { makeAutoObservable, runInAction } from "mobx";
import type { FailureKind } from "@/lib/result";
import { phaseEndsAt, secondsUntil } from "@/lib/roulette";

/** What `/api/roulette/live` answers: the live table, or why there is none. */
export type LiveAnswer =
  | { ok: true; data: AdminLive; serverTime: string }
  | { ok: false; kind: FailureKind };

export type LiveTimers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export type LiveDeps = {
  /** One read of the live table (never throws: a lost answer is "unavailable"). */
  read: () => Promise<LiveAnswer>;
  timers: LiveTimers;
  intervalMs: number;
};

/** Failures that will not heal by asking again: polling stops. */
const final: ReadonlySet<FailureKind> = new Set([
  "unauthenticated",
  "forbidden",
]);

/**
 * The live table of the roulette, read every few seconds while the page is
 * visible (a hidden tab asks nothing, and catches up when shown again).
 * The last good answer stays on screen when a read fails, marked stale;
 * the countdown runs on the server's clock (the offset of the last answer).
 */
export class RouletteLiveStore {
  data: AdminLive;
  /** Client time of the last good answer. */
  readAt: number;
  /** Server clock minus client clock, from the last good answer. */
  offset: number;
  now: number;
  /** Why the last read failed; null while answers come. */
  failure: FailureKind | null = null;
  private running = false;
  private visible = true;
  private reading = false;
  private handle: unknown = null;

  constructor(
    private readonly deps: LiveDeps,
    initial: { data: AdminLive; serverTime: string },
    now: number,
  ) {
    this.data = initial.data;
    this.readAt = now;
    this.now = now;
    this.offset = offsetOf(initial.serverTime, now);
    makeAutoObservable<
      RouletteLiveStore,
      "deps" | "running" | "visible" | "reading" | "handle"
    >(this, {
      deps: false,
      running: false,
      visible: false,
      reading: false,
      handle: false,
    });
  }

  /** Seconds left in the current phase, on the server's clock. */
  get secondsLeft(): number | null {
    const round = this.data.round;
    if (!round) return null;
    return secondsUntil(phaseEndsAt(round), this.now + this.offset);
  }

  /** Seconds since the last good answer. */
  get age(): number {
    return Math.max(0, Math.floor((this.now - this.readAt) / 1000));
  }

  get stopped(): boolean {
    return this.failure !== null && final.has(this.failure);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.cancel();
  }

  /** A hidden page stops asking; shown again, it asks at once. */
  setVisible(visible: boolean, now: number) {
    this.visible = visible;
    if (!visible) {
      this.cancel();
      return;
    }
    this.tick(now);
    if (this.running && !this.reading && !this.stopped) void this.poll(now);
  }

  tick(now: number) {
    this.now = now;
  }

  async poll(now: number) {
    if (this.reading || this.stopped) return;
    this.cancel();
    this.reading = true;
    let answer: LiveAnswer;
    try {
      answer = await this.deps.read();
    } catch {
      answer = { ok: false, kind: "unavailable" };
    }
    runInAction(() => {
      this.reading = false;
      if (answer.ok) {
        this.data = answer.data;
        this.readAt = now;
        this.offset = offsetOf(answer.serverTime, now);
        this.failure = null;
      } else {
        this.failure = answer.kind;
      }
    });
    this.schedule();
  }

  private schedule() {
    this.cancel();
    if (!this.running || !this.visible || this.stopped) return;
    this.handle = this.deps.timers.set(
      () => void this.poll(Date.now()),
      this.deps.intervalMs,
    );
  }

  private cancel() {
    if (this.handle !== null) this.deps.timers.clear(this.handle);
    this.handle = null;
  }
}

function offsetOf(serverTime: string, now: number): number {
  const server = Date.parse(serverTime);
  return Number.isNaN(server) ? 0 : server - now;
}
