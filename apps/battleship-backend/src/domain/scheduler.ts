import type { Clock } from "./ports.js";

export type Task = () => unknown;

export interface TimerHandle {
  /** When the task falls due, in clock time. */
  readonly at: Date;
  cancel(): void;
}

/**
 * Game timers (placement and turn clocks, reconnect grace, bot thinking).
 * Time comes from the injected clock, so tests drive every timer with a
 * manual clock instead of sleeping.
 */
export interface Scheduler {
  /** Runs `task` once the clock reaches `at`. */
  at(at: Date, task: Task): TimerHandle;
  /** Runs `task` after `ms` of clock time. */
  after(ms: number, task: Task): TimerHandle;
  /** Cancels every pending task (shutdown). */
  cancelAll(): void;
}

/** Production scheduler: real timers aimed at clock deadlines. */
export class SystemScheduler implements Scheduler {
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly clock: Clock,
    private readonly onError: (error: unknown) => void,
  ) {}

  at(at: Date, task: Task): TimerHandle {
    const delay = Math.max(0, at.getTime() - this.clock.now().getTime());
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      try {
        Promise.resolve(task()).catch(this.onError);
      } catch (error) {
        this.onError(error);
      }
    }, delay);
    this.timers.add(timer);
    return {
      at,
      cancel: () => {
        clearTimeout(timer);
        this.timers.delete(timer);
      },
    };
  }

  after(ms: number, task: Task): TimerHandle {
    return this.at(new Date(this.clock.now().getTime() + ms), task);
  }

  cancelAll() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}
