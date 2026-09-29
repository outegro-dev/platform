import { describe, expect, it } from "vitest";
import { ReplayStore } from "@/stores/replay-store";
import { afloat, boardAt, type Placement, type Shot, shipCells } from "./board";

const fleetB: Placement[] = [
  { x: 0, y: 0, length: 2, orientation: "horizontal" },
  { x: 5, y: 5, length: 1, orientation: "vertical" },
];
const fleetA: Placement[] = [
  { x: 9, y: 0, length: 3, orientation: "vertical" },
];
const moves: Shot[] = [
  { n: 1, side: "a", x: 0, y: 0, outcome: "hit" },
  { n: 2, side: "a", x: 3, y: 3, outcome: "miss" },
  { n: 3, side: "b", x: 9, y: 1, outcome: "hit" },
  { n: 4, side: "b", x: null, y: null, outcome: "skip" },
  { n: 5, side: "a", x: 1, y: 0, outcome: "sunk" },
];

describe("board state", () => {
  it("lays ships along their orientation", () => {
    expect(
      shipCells({ x: 2, y: 3, length: 3, orientation: "vertical" }),
    ).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 4 },
      { x: 2, y: 5 },
    ]);
  });

  it("puts side a's shots on board b, up to the step", () => {
    const early = boardAt("b", fleetB, moves, 2);
    expect(early[0]?.[0]?.shot).toBe("hit");
    expect(early[3]?.[3]?.shot).toBe("miss");
    expect(early[0]?.[1]?.shot).toBeNull();
    expect(early[3]?.[3]?.last).toBe(true);
    const own = boardAt("a", fleetA, moves, 2);
    expect(own.flat().some((cell) => cell.shot !== null)).toBe(false);
  });

  it("marks a ship sunk once every cell is hit", () => {
    const board = boardAt("b", fleetB, moves, 5);
    expect(board[0]?.[0]?.shot).toBe("sunk");
    expect(board[0]?.[1]?.shot).toBe("sunk");
    expect(afloat(fleetB, board)).toBe(1);
  });

  it("uses recorded outcomes when the fleet is hidden", () => {
    const board = boardAt("b", null, moves, 5);
    expect(board[0]?.[1]?.shot).toBe("hit");
    expect(board[3]?.[3]?.shot).toBe("miss");
  });
});

describe("replay store", () => {
  it("starts at the end and steps within bounds", () => {
    const store = new ReplayStore({ a: fleetA, b: fleetB }, moves);
    expect(store.step).toBe(5);
    expect(store.atEnd).toBe(true);
    store.next();
    expect(store.step).toBe(5);
    store.first();
    expect(store.atStart).toBe(true);
    expect(store.current).toBeNull();
    store.goTo(3);
    expect(store.current?.n).toBe(3);
    expect(store.boardA[1]?.[9]?.shot).toBe("hit");
    store.previous();
    expect(store.boardA[1]?.[9]?.shot).toBeNull();
    store.goTo(99);
    expect(store.step).toBe(5);
  });
});
