import type { ManualClock } from "@outegro/nest-common";
import type { Scheduler, Task, TimerHandle } from "../domain/scheduler.js";

type Entry = { at: number; order: number; task: Task; cancelled: boolean };

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Test scheduler on a ManualClock: nothing runs until the test advances time,
 * then every task that falls due runs in time order and is awaited. No sleeps.
 */
export class ManualScheduler implements Scheduler {
  private entries: Entry[] = [];
  private order = 0;

  constructor(private readonly clock: ManualClock) {}

  at(at: Date, task: Task): TimerHandle {
    const entry: Entry = {
      at: at.getTime(),
      order: this.order++,
      task,
      cancelled: false,
    };
    this.entries.push(entry);
    return {
      at,
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }

  after(ms: number, task: Task): TimerHandle {
    return this.at(new Date(this.clock.now().getTime() + ms), task);
  }

  cancelAll() {
    for (const entry of this.entries) entry.cancelled = true;
    this.entries = [];
  }

  /** Tasks still waiting. */
  get pending(): number {
    return this.entries.filter((entry) => !entry.cancelled).length;
  }

  /** Moves the clock forward by `ms`, running every task that falls due. */
  async advance(ms: number): Promise<void> {
    const target = this.clock.now().getTime() + ms;
    for (;;) {
      this.entries = this.entries.filter((entry) => !entry.cancelled);
      const due = this.entries
        .filter((entry) => entry.at <= target)
        .sort((a, b) => a.at - b.at || a.order - b.order)[0];
      if (!due) break;
      this.entries.splice(this.entries.indexOf(due), 1);
      if (due.at > this.clock.now().getTime()) this.clock.set(new Date(due.at));
      await due.task();
      await settle();
    }
    this.clock.set(new Date(target));
    await settle();
  }
}
