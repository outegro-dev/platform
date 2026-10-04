import type {
  EventLoopPhase,
  EventLoopScenario,
  Inline,
} from "@outegro/contracts/edu";

/** One moment of the event loop simulator, every field filled in. */
export type EventLoopState = {
  /** Highlighted code line, 1-based; 0 means none. */
  l: number;
  ph: EventLoopPhase;
  stack: string[];
  tick: string[];
  micro: string[];
  timers: string[];
  check: string[];
  io: string[];
  out: string[];
  note: Inline[];
};

const start: EventLoopState = {
  l: 0,
  ph: "main",
  stack: [],
  tick: [],
  micro: [],
  timers: [],
  check: [],
  io: [],
  out: [],
  note: [],
};

/** Every step as a full state: fields a step omits carry over. */
export function resolveEventLoopSteps(
  scenario: EventLoopScenario,
): EventLoopState[] {
  let state = start;
  return scenario.steps.map((step) => {
    state = { ...state };
    for (const [key, value] of Object.entries(step))
      if (value !== undefined) Object.assign(state, { [key]: value });
    return state;
  });
}

/** Output lines that appeared in step `index` (to highlight them). */
export function newOutput(states: readonly EventLoopState[], index: number) {
  const current = states[index]?.out ?? [];
  const before = index > 0 ? (states[index - 1]?.out.length ?? 0) : 0;
  return current.map((_, k) => k >= before);
}
