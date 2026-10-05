import type { EventLoopPhase } from "@outegro/contracts/edu";
import type { EventLoopState } from "./simulator.js";

/*
 * How the event loop simulator reads one state: the strip of phases (the
 * script with its queues, then the loop's phases, then exit) and the queue
 * the current phase is working on.
 */

/** A phase, or one of the strip's two breaks: before the loop and after it. */
export type PhaseStripItem = EventLoopPhase | "loop" | "end";

/** The phase strip: the script and its queues │ the loop's phases │ exit. */
export const phaseStrip: readonly PhaseStripItem[] = Object.freeze([
  "main",
  "ticks",
  "micro",
  "loop",
  "timers",
  "pending",
  "poll",
  "check",
  "close",
  "end",
  "exit",
] as const);

/** Whether a strip item is a break rather than a phase. */
export const isStripBreak = (item: PhaseStripItem): item is "loop" | "end" =>
  item === "loop" || item === "end";

/** The queues the simulator shows, in their order. */
export type SimulatorQueue =
  | "stack"
  | "tick"
  | "micro"
  | "timers"
  | "check"
  | "io";

export const simulatorQueues: readonly SimulatorQueue[] = Object.freeze([
  "stack",
  "tick",
  "micro",
  "timers",
  "check",
  "io",
] as const);

/** The queue the current phase is working on (the call stack: while busy). */
export function isHotQueue(
  queue: SimulatorQueue,
  state: Pick<EventLoopState, "ph" | "stack">,
): boolean {
  switch (queue) {
    case "stack":
      return state.stack.length > 0;
    case "tick":
      return state.ph === "ticks";
    case "micro":
      return state.ph === "micro";
    case "timers":
      return state.ph === "timers";
    case "check":
      return state.ph === "check";
    case "io":
      return state.ph === "poll";
  }
}
