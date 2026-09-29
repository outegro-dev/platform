import { makeAutoObservable, observable, runInAction } from "mobx";
import type { Order } from "@/lib/payments/model";
import { isSettled, orderPhase } from "@/lib/payments/status";
import { browserScheduler, type Scheduler } from "./scheduler";

/** What one look at the order through the BFF returned. */
export type WatchResponse =
  | { status: "ok"; order: Order }
  | { status: "not-found" }
  | { status: "signed-out" }
  | { status: "unavailable" };

export type WatchPhase =
  /** Not started (or stopped on unmount). */
  | "idle"
  /** Polling until the server settles the order. */
  | "watching"
  /** Paid with access, failed or refunded: nothing more to wait for. */
  | "settled"
  /** The window ran out; the user can check again. */
  | "timed-out"
  | "signed-out"
  | "gone";

export const POLL_INTERVAL_MS = 3_000;
export const POLL_WINDOW_MS = 180_000;

type Deps = {
  load: (orderId: string) => Promise<WatchResponse>;
  scheduler?: Scheduler;
  intervalMs?: number;
  windowMs?: number;
};

/**
 * Watches one order after the buyer comes back from Lava (or opens a
 * pending order): asks the server every 3 s for up to 3 min, until the
 * order is settled. The return URL proves nothing; only the server's
 * answer changes what is shown. One request at a time: a newer request
 * supersedes an older one, and restarts (unmount, "check again") start a
 * new generation whose timers ignore the old one.
 */
export class OrderWatchStore {
  order: Order;
  phase: WatchPhase = "idle";
  /** Transient trouble that does not stop the watch. */
  trouble: "none" | "retrying" | "offline" = "none";
  /** Answers received in this window. */
  checks = 0;

  private readonly load: Deps["load"];
  private readonly scheduler: Scheduler;
  private readonly intervalMs: number;
  private readonly windowMs: number;
  private generation = 0;
  private request = 0;
  private startedAt = 0;
  private timer: unknown = null;

  constructor(initial: Order, deps: Deps) {
    this.order = initial;
    this.load = deps.load;
    this.scheduler = deps.scheduler ?? browserScheduler;
    this.intervalMs = deps.intervalMs ?? POLL_INTERVAL_MS;
    this.windowMs = deps.windowMs ?? POLL_WINDOW_MS;
    makeAutoObservable<
      this,
      | "load"
      | "scheduler"
      | "intervalMs"
      | "windowMs"
      | "generation"
      | "request"
      | "startedAt"
      | "timer"
    >(
      this,
      {
        order: observable.ref,
        load: false,
        scheduler: false,
        intervalMs: false,
        windowMs: false,
        generation: false,
        request: false,
        startedAt: false,
        timer: false,
      },
      { autoBind: true },
    );
  }

  /** The order in one word: processing, activating, paid, failed… */
  get outcome() {
    return orderPhase(this.order);
  }

  /** Begin (or resume after unmount) watching. Settled orders are not polled. */
  start() {
    this.generation += 1;
    this.clearTimer();
    if (isSettled(this.order)) {
      this.phase = "settled";
      return;
    }
    this.phase = "watching";
    this.startedAt = this.scheduler.now();
    this.checks = 0;
    if (this.trouble !== "offline") this.schedule(this.intervalMs);
  }

  /** Stop all timers; late answers are ignored. */
  stop() {
    this.generation += 1;
    this.clearTimer();
    if (this.phase === "watching") this.phase = "idle";
  }

  /** "Check again" after the window ran out: a fresh window, asking now. */
  checkAgain() {
    if (this.phase === "settled" || this.phase === "gone") return;
    this.generation += 1;
    this.clearTimer();
    this.phase = "watching";
    this.startedAt = this.scheduler.now();
    this.checks = 0;
    if (this.trouble === "retrying") this.trouble = "none";
    void this.poll(this.generation);
  }

  /** Browser went offline or came back. */
  setOnline(online: boolean) {
    if (!online) {
      this.trouble = "offline";
      this.clearTimer();
      return;
    }
    if (this.trouble !== "offline") return;
    this.trouble = "none";
    if (this.phase === "watching") void this.poll(this.generation);
  }

  private schedule(ms: number) {
    this.clearTimer();
    const generation = this.generation;
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.poll(generation);
    }, ms);
  }

  private clearTimer() {
    if (this.timer !== null) this.scheduler.clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(generation: number) {
    if (
      generation !== this.generation ||
      this.phase !== "watching" ||
      this.trouble === "offline"
    )
      return;
    this.clearTimer();
    const request = ++this.request;
    let response: WatchResponse;
    try {
      response = await this.load(this.order.id);
    } catch {
      response = { status: "unavailable" };
    }
    runInAction(() => this.receive(generation, request, response));
  }

  private receive(
    generation: number,
    request: number,
    response: WatchResponse,
  ) {
    // Superseded by a restart or a newer request: that one continues.
    if (generation !== this.generation || request !== this.request) return;
    if (this.phase !== "watching") return;
    this.checks += 1;
    switch (response.status) {
      case "ok":
        this.order = response.order;
        if (this.trouble === "retrying") this.trouble = "none";
        if (isSettled(response.order)) {
          this.phase = "settled";
          return;
        }
        break;
      case "signed-out":
        this.phase = "signed-out";
        return;
      case "not-found":
        this.phase = "gone";
        return;
      case "unavailable":
        if (this.trouble !== "offline") this.trouble = "retrying";
        break;
    }
    if (this.scheduler.now() - this.startedAt >= this.windowMs) {
      this.phase = "timed-out";
      return;
    }
    if (this.trouble !== "offline") this.schedule(this.intervalMs);
  }
}
