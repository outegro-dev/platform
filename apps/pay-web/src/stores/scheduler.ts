/** Timers behind an interface, so stores run on fake time in tests. */
export type Scheduler = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
};

export const browserScheduler: Scheduler = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** Resolves after `ms` on the given scheduler. */
export const wait = (scheduler: Scheduler, ms: number) =>
  new Promise<void>((resolve) => {
    scheduler.setTimeout(resolve, ms);
  });

/** navigator.onLine, true where it is unknown (server, tests). */
export const browserIsOnline = () =>
  typeof navigator === "undefined" ? true : navigator.onLine !== false;
