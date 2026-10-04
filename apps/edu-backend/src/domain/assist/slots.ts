/** No slot came free in time, or the caller gave up waiting. */
export class NoSlot extends Error {
  constructor(readonly reason: "timeout" | "aborted") {
    super(`no slot: ${reason}`);
    this.name = "NoSlot";
  }
}

type Waiter = { grant: () => void };

/**
 * At most `size` holders at once; the rest wait in line (first come, first
 * served) for a bounded time. A slot is handed back once, whatever the
 * holder does with its release function afterwards.
 */
export class Slots {
  private free: number;
  private readonly line: Waiter[] = [];

  constructor(readonly size: number) {
    if (!Number.isInteger(size) || size < 1)
      throw new RangeError("at least one slot");
    this.free = size;
  }

  /** Holders right now. */
  get busy(): number {
    return this.size - this.free;
  }

  /** Callers waiting in line right now. */
  get waiting(): number {
    return this.line.length;
  }

  /** A release function once a slot is free; NoSlot after `waitMs` or on abort. */
  acquire(waitMs: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new NoSlot("aborted"));
    if (this.free > 0) {
      this.free--;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        grant: () => {
          stop();
          resolve(this.releaser());
        },
      };
      const leave = (reason: NoSlot["reason"]) => {
        const index = this.line.indexOf(waiter);
        if (index >= 0) this.line.splice(index, 1);
        stop();
        reject(new NoSlot(reason));
      };
      const timer = setTimeout(() => leave("timeout"), waitMs);
      const onAbort = () => leave("aborted");
      const stop = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.line.push(waiter);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.line.shift();
      // The slot goes straight to the next in line, or back to the pool.
      if (next) next.grant();
      else this.free++;
    };
  }
}
