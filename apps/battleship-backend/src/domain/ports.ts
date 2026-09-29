/**
 * Framework-free ports the domain depends on. Nest wires the adapters; tests
 * pass fakes (ManualScheduler, SeededRandom) through the same interfaces.
 */

/** Current time; the platform CLOCK (ManualClock in tests). */
export interface Clock {
  now(): Date;
}

/** Structured logging without depending on a framework logger. */
export interface LogPort {
  warn(message: unknown, ...context: unknown[]): void;
  error(message: unknown, ...context: unknown[]): void;
}
