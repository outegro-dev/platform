import {
  type EventLoopState,
  isHotQueue,
  isStripBreak,
  newOutput,
  type PhaseStripItem,
  phaseStrip,
  type SimulatorQueue,
  simulatorQueues,
} from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";

export type SimulatorScenario = {
  name: string;
  /** Code lines as highlight.js markup (highlighted on the server). */
  lines: string[];
  /** Every step as a full state (`resolveEventLoopSteps`). */
  steps: EventLoopState[];
};

export type StripItem = { item: PhaseStripItem; isBreak: boolean; on: boolean };

/**
 * The event loop simulator: a scenario and a step in it. Each step is the
 * line being run, where the loop is, what waits in each queue, what the
 * console printed (the lines this step printed stand out) and a note.
 */
export class SimulatorStore {
  scenarioIndex = 0;
  step = 0;
  readonly scenarios: readonly SimulatorScenario[];

  constructor(scenarios: readonly SimulatorScenario[]) {
    this.scenarios = scenarios;
    makeAutoObservable(this, { scenarios: false }, { autoBind: true });
  }

  get scenario(): SimulatorScenario | null {
    return this.scenarios[this.scenarioIndex] ?? this.scenarios[0] ?? null;
  }

  get total(): number {
    return this.scenario?.steps.length ?? 0;
  }

  get state(): EventLoopState | null {
    return this.scenario?.steps[Math.min(this.step, this.total - 1)] ?? null;
  }

  get atStart(): boolean {
    return this.step === 0;
  }

  get atEnd(): boolean {
    return this.step >= this.total - 1;
  }

  /** Which console lines this step printed. */
  get fresh(): boolean[] {
    return this.scenario ? newOutput(this.scenario.steps, this.step) : [];
  }

  get strip(): StripItem[] {
    const phase = this.state?.ph;
    return phaseStrip.map((item) => ({
      item,
      isBreak: isStripBreak(item),
      on: item === phase,
    }));
  }

  get queues(): readonly SimulatorQueue[] {
    return simulatorQueues;
  }

  isHot(queue: SimulatorQueue): boolean {
    return this.state ? isHotQueue(queue, this.state) : false;
  }

  pick(index: number) {
    if (!this.scenarios[index]) return;
    this.scenarioIndex = index;
    this.step = 0;
  }

  first() {
    this.step = 0;
  }

  back() {
    if (!this.atStart) this.step -= 1;
  }

  next() {
    if (!this.atEnd) this.step += 1;
  }
}
