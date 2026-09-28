import { Global, Module } from "@nestjs/common";

/** Injectable time source, so expiry rules are testable without sleeping. */
export const CLOCK = Symbol("CLOCK");

export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

/** Test clock: `clock.set(...)`, `clock.advance(ms)`. */
export class ManualClock implements Clock {
  constructor(private current = new Date("2026-01-01T00:00:00.000Z")) {}
  now() {
    return new Date(this.current);
  }
  set(date: Date) {
    this.current = new Date(date);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Provides CLOCK (system time); tests override it with ManualClock. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class ClockModule {}
