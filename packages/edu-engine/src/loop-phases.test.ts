import { eventLoopPhaseSchema } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import {
  isHotQueue,
  isStripBreak,
  phaseStrip,
  simulatorQueues,
} from "./loop-phases.js";

describe("the event loop phase strip", () => {
  it("shows every phase once, with the loop between two breaks", () => {
    const phases = phaseStrip.filter((item) => !isStripBreak(item));
    expect([...phases].sort()).toEqual(
      [...eventLoopPhaseSchema.options].sort(),
    );
    expect(phaseStrip.indexOf("loop")).toBeLessThan(
      phaseStrip.indexOf("timers"),
    );
    expect(phaseStrip.indexOf("end")).toBeGreaterThan(
      phaseStrip.indexOf("close"),
    );
    expect(phaseStrip.at(-1)).toBe("exit");
  });
});

describe("the queue the loop works on", () => {
  const at = (
    ph: (typeof eventLoopPhaseSchema.options)[number],
    stack: string[] = [],
  ) => simulatorQueues.filter((queue) => isHotQueue(queue, { ph, stack }));

  it("follows the phase", () => {
    expect(at("ticks")).toEqual(["tick"]);
    expect(at("micro")).toEqual(["micro"]);
    expect(at("timers")).toEqual(["timers"]);
    expect(at("check")).toEqual(["check"]);
    expect(at("poll")).toEqual(["io"]);
    expect(at("pending")).toEqual([]);
    expect(at("close")).toEqual([]);
  });

  it("marks the call stack while it holds anything", () => {
    expect(at("main", ["главный модуль"])).toEqual(["stack"]);
    expect(at("main")).toEqual([]);
  });
});
