import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemoLoop } from "./demo-loop";
import {
  demoBeats,
  demoFleet,
  demoFrame,
  demoShots,
  demoTiming,
} from "./demo-script";

const sunkShot = demoShots.findIndex((shot) => shot.outcome === "sunk");
const beatOf = (phase: string, shot: number) =>
  demoBeats.findIndex((beat) => beat.phase === phase && beat.shot === shot);

describe("demo script", () => {
  it("rests on the full picture: every ship afloat or wrecked, every mark", () => {
    const frame = demoFrame(0);
    expect(frame.phase).toBe("hold");
    expect(frame.ships.every((ship) => ship.shown)).toBe(true);
    expect(frame.ships.filter((ship) => ship.wreck)).toHaveLength(1);
    expect(frame.ships.some((ship) => ship.sinking)).toBe(false);
    const kinds = frame.marks.map((mark) => mark.kind);
    expect(kinds.filter((kind) => kind === "hit")).toHaveLength(3);
    expect(kinds.filter((kind) => kind === "sunk")).toHaveLength(2);
    // Five misses and the ten cells of water around the sunk destroyer.
    expect(kinds.filter((kind) => kind === "miss")).toHaveLength(15);
    expect(frame.effect).toBeNull();
    expect(frame.aiming).toBe(false);
  });

  it("never marks the same cell twice, and never a mark on a ship's water", () => {
    const frame = demoFrame(0);
    const cells = frame.marks.map((mark) => `${mark.x},${mark.y}`);
    expect(new Set(cells).size).toBe(cells.length);
    const shipCells = new Set(
      demoFleet.flatMap((ship) =>
        Array.from({ length: ship.length }, (_, i) =>
          ship.orientation === "horizontal"
            ? `${ship.x + i},${ship.y}`
            : `${ship.x},${ship.y + i}`,
        ),
      ),
    );
    for (const mark of frame.marks) {
      expect(shipCells.has(`${mark.x},${mark.y}`), `${mark.x},${mark.y}`).toBe(
        mark.kind !== "miss",
      );
    }
  });

  it("clears the board for a new round and hides the fleet", () => {
    const reset = demoFrame(1);
    expect(reset.phase).toBe("reset");
    expect(reset.ships.every((ship) => !ship.shown)).toBe(true);
    const first = demoFrame(2);
    expect(first.phase).toBe("aim");
    expect(first.marks).toEqual([]);
    expect(first.aiming).toBe(true);
    expect(first.aim).toEqual({ x: demoShots[0]?.x, y: demoShots[0]?.y });
  });

  it("aims, fires, then leaves the mark where the shell landed", () => {
    const [aim, fire, land] = ["aim", "fire", "land"].map((phase) =>
      demoFrame(beatOf(phase, 0)),
    );
    expect(aim?.effect).toBeNull();
    expect(fire?.effect).toEqual({ kind: "fire", x: 5, y: 0 });
    expect(fire?.marks).toEqual([]);
    expect(land?.effect).toEqual({ kind: "miss", x: 5, y: 0 });
    expect(land?.aiming).toBe(false);
    expect(land?.marks).toEqual([{ x: 5, y: 0, kind: "miss", delay: 0 }]);
  });

  it("reveals a ship only when it is sunk, and rings its water in a ripple", () => {
    const before = demoFrame(beatOf("fire", sunkShot));
    expect(before.ships.some((ship) => ship.shown)).toBe(false);
    expect(before.marks.filter((mark) => mark.kind === "hit")).toHaveLength(3);

    const sunk = demoFrame(beatOf("land", sunkShot));
    const revealed = sunk.ships.filter((ship) => ship.shown);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toMatchObject({ wreck: true, sinking: true });
    expect(revealed[0]?.ship).toMatchObject({ x: 3, y: 4, length: 2 });
    expect(sunk.marks.filter((mark) => mark.kind === "sunk")).toHaveLength(2);
    const ring = sunk.marks.filter((mark) => mark.delay > 0);
    expect(ring).toHaveLength(10);
    expect(ring.map((mark) => mark.delay)).toEqual(
      ring.map((_, i) => demoTiming.ringStart + i * demoTiming.ringStep),
    );

    // The next beat keeps the ring but no longer staggers it.
    const after = demoFrame(beatOf("aim", sunkShot + 1));
    expect(after.marks.filter((mark) => mark.delay > 0)).toEqual([]);
    expect(after.ships.filter((ship) => ship.shown)).toHaveLength(1);
  });

  it("ends a round on the full picture", () => {
    const last = demoFrame(demoBeats.length - 1);
    expect(last.phase).toBe("land");
    expect(last.marks).toHaveLength(demoFrame(0).marks.length);
    expect(last.ships.filter((ship) => ship.shown)).toHaveLength(1);
  });
});

describe("DemoLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function playing() {
    const loop = new DemoLoop();
    loop.start();
    loop.setMotion(true);
    loop.setOnScreen(true);
    return loop;
  }

  it("does nothing until it is started, on screen and allowed to move", () => {
    const loop = new DemoLoop();
    loop.setMotion(true);
    loop.setOnScreen(true);
    vi.advanceTimersByTime(60_000);
    expect(loop.beat).toBe(0);
    expect(loop.playing).toBe(false);
    loop.start();
    expect(loop.playing).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(loop.beat).toBe(1);
    expect(loop.round).toBe(1);
  });

  it("plays beat after beat and loops back to the still picture", () => {
    const loop = playing();
    vi.advanceTimersByTime(1200);
    expect(loop.frame.phase).toBe("reset");
    vi.advanceTimersByTime(demoTiming.reset);
    expect(loop.frame.phase).toBe("aim");
    const rest = demoBeats.slice(2).reduce((sum, beat) => sum + beat.ms, 0);
    vi.advanceTimersByTime(rest);
    expect(loop.beat).toBe(0);
    expect(loop.frame.phase).toBe("hold");
    // Later rounds rest longer on the full picture than the first one.
    vi.advanceTimersByTime(demoTiming.hold - 1);
    expect(loop.beat).toBe(0);
    vi.advanceTimersByTime(1);
    expect(loop.beat).toBe(1);
    expect(loop.round).toBe(2);
  });

  it("pauses off screen and in a hidden tab, and goes on where it stopped", () => {
    const loop = playing();
    vi.advanceTimersByTime(1200 + demoTiming.reset);
    expect(loop.beat).toBe(2);
    loop.setOnScreen(false);
    expect(loop.playing).toBe(false);
    expect(loop.paused).toBe(true);
    vi.advanceTimersByTime(30_000);
    expect(loop.beat).toBe(2);
    loop.setOnScreen(true);
    expect(loop.paused).toBe(false);
    vi.advanceTimersByTime(demoTiming.aim);
    expect(loop.beat).toBe(3);
    loop.setPageVisible(false);
    vi.advanceTimersByTime(30_000);
    expect(loop.beat).toBe(3);
    loop.setPageVisible(true);
    vi.advanceTimersByTime(demoTiming.fire);
    expect(loop.beat).toBe(4);
  });

  it("with reduced motion rests on the still picture and never moves", () => {
    const loop = playing();
    vi.advanceTimersByTime(1200 + demoTiming.reset + demoTiming.aim);
    expect(loop.beat).toBe(3);
    loop.setMotion(false);
    expect(loop.beat).toBe(0);
    expect(loop.playing).toBe(false);
    expect(loop.paused).toBe(false);
    vi.advanceTimersByTime(120_000);
    expect(loop.beat).toBe(0);
  });

  it("stops for good when disposed", () => {
    const loop = playing();
    loop.dispose();
    vi.advanceTimersByTime(120_000);
    expect(loop.beat).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
