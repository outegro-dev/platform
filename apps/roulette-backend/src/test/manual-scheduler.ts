import type { ManualClock } from "@outegro/nest-common";
import type { Scheduler, Task, TimerHandle } from "../domain/scheduler.js";

type Entry = {
  at: number;
  order: number;
  owner: string;
  task: Task;
  cancelled: boolean;
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * One manual timeline for several app instances on a ManualClock. Each
 * instance gets its own view; nothing runs until the test advances time,
 * then every due task runs in time order and is awaited. `freeze(owner)`
 * drops an instance's timers, as if its process stopped (a GC pause, a
 * frozen VM): the lease it holds runs out and nobody renews it.
 */
export class SharedManualScheduler {
  private entries: Entry[] = [];
  private order = 0;
  private readonly frozen = new Set<string>();

  constructor(private readonly clock: ManualClock) {}

  view(owner: string): Scheduler {
    return {
      at: (at, task) => this.add(owner, at, task),
      after: (ms, task) =>
        this.add(owner, new Date(this.clock.now().getTime() + ms), task),
      cancelAll: () => {
        for (const entry of this.entries)
          if (entry.owner === owner) entry.cancelled = true;
      },
    };
  }

  freeze(owner: string) {
    this.frozen.add(owner);
    for (const entry of this.entries)
      if (entry.owner === owner) entry.cancelled = true;
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

  private add(owner: string, at: Date, task: Task): TimerHandle {
    const entry: Entry = {
      at: at.getTime(),
      order: this.order++,
      owner,
      task,
      cancelled: this.frozen.has(owner),
    };
    this.entries.push(entry);
    return {
      at,
      cancel: () => {
        entry.cancelled = true;
      },
    };
  }
}
