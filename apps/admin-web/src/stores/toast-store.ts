import { makeAutoObservable } from "mobx";

export type Toast = { id: number; tone: "ok" | "bad"; text: string };

type Timers = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Short confirmations after an action ("Role granted"); one live region. */
export class ToastStore {
  items: Toast[] = [];
  private nextId = 1;
  private readonly handles = new Map<number, unknown>();

  constructor(
    private readonly timers: Timers = browserTimers,
    private readonly lifetimeMs = 6000,
  ) {
    makeAutoObservable<ToastStore, "handles" | "nextId" | "timers">(this, {
      handles: false,
      nextId: false,
      timers: false,
    });
  }

  push(tone: Toast["tone"], text: string): number {
    const id = this.nextId++;
    // At most three at once: the oldest makes room.
    this.items = [...this.items.slice(-2), { id, tone, text }];
    this.handles.set(
      id,
      this.timers.set(() => this.dismiss(id), this.lifetimeMs),
    );
    return id;
  }

  dismiss(id: number): void {
    const handle = this.handles.get(id);
    if (handle !== undefined) this.timers.clear(handle);
    this.handles.delete(id);
    this.items = this.items.filter((toast) => toast.id !== id);
  }
}
