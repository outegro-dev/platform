import {
  Coordinate,
  classicRules,
  type FleetError,
  FleetValidator,
  fleetLengths,
  type GameRules,
  MathRandom,
  type Orientation,
  outlineOf,
  placementCells,
  type Random,
  RandomPlacement,
  type ShipPlacement,
} from "@outegro/battleship-engine";
import type {
  GameErrorCode,
  MatchSnapshot,
  ServerMessage,
} from "@outegro/contracts/battleship";
import { makeAutoObservable } from "mobx";
import type { MessageSender } from "../transport/game-socket";

export type PlacementIssue = "out_of_bounds" | "overlap" | "touching";
export type Cell = { x: number; y: number };
export type ShipSlot = {
  id: number;
  length: number;
  placement: ShipPlacement | null;
};

type Preview = {
  placement: ShipPlacement;
  cells: Cell[];
  issue: PlacementIssue | null;
};

const keyOf = (x: number, y: number) => `${x},${y}`;

function createSlots(rules: GameRules): ShipSlot[] {
  return fleetLengths(rules).map((length, id) => ({
    id,
    length,
    placement: null,
  }));
}

/**
 * The fleet editor: drag and drop, tap-to-place and keyboard placement,
 * rotation, random fleet and inline reasons for a spot that is not allowed.
 * The rules (bounds, overlap, no touching, composition) come from the
 * engine; the server checks the fleet again when it is submitted (TC-BS-01).
 */
export class PlacementStore {
  slots: ShipSlot[];
  selectedId: number | null;
  /** Orientation of the selected ship's next placement. */
  orientation: Orientation = "horizontal";
  /** Keyboard cursor on the board. */
  cursor: Cell = { x: 0, y: 0 };
  /** Keyboard focus is on the board: preview follows the cursor. */
  cursorActive = false;
  /** Cell under the pointer while hovering or dragging. */
  pointer: Cell | null = null;
  /** Ship being dragged and which of its segments was grabbed. */
  drag: { id: number; grab: number } | null = null;
  /** Why the last attempt to place a ship failed. */
  issue: PlacementIssue | null = null;
  /** The last ship put on the board, for the live announcement. */
  lastPlaced: ShipPlacement | null = null;
  submitSeq: number | null = null;
  submitted = false;
  serverError: GameErrorCode | null = null;
  private readonly validator: FleetValidator;

  constructor(
    private readonly sender: MessageSender,
    private readonly rules: GameRules = classicRules,
    private readonly random: Random = new MathRandom(),
  ) {
    this.slots = createSlots(rules);
    this.selectedId = this.slots[0]?.id ?? null;
    this.validator = new FleetValidator(rules);
    makeAutoObservable<
      PlacementStore,
      "sender" | "rules" | "random" | "validator"
    >(
      this,
      {
        sender: false,
        rules: false,
        random: false,
        validator: false,
        check: false,
        slotAt: false,
      },
      { autoBind: true },
    );
  }

  get size(): number {
    return this.rules.boardSize;
  }

  get hand(): ShipSlot[] {
    return this.slots.filter((slot) => slot.placement === null);
  }

  get placed(): ShipSlot[] {
    return this.slots.filter((slot) => slot.placement !== null);
  }

  get complete(): boolean {
    return this.hand.length === 0;
  }

  get fleet(): ShipPlacement[] {
    return this.placed.map((slot) => slot.placement as ShipPlacement);
  }

  /** The first rule the whole fleet breaks; null when it can be submitted. */
  get fleetError(): FleetError | null {
    return this.validator.validate(this.fleet);
  }

  get pendingSubmit(): boolean {
    return this.submitSeq !== null;
  }

  get canSubmit(): boolean {
    return (
      this.complete &&
      this.fleetError === null &&
      !this.submitted &&
      !this.pendingSubmit
    );
  }

  get selected(): ShipSlot | null {
    return this.slots.find((slot) => slot.id === this.selectedId) ?? null;
  }

  /** Which ship covers each cell. */
  get occupancy(): Map<string, number> {
    const map = new Map<string, number>();
    for (const slot of this.placed) {
      for (const cell of placementCells(slot.placement as ShipPlacement)) {
        map.set(cell.key, slot.id);
      }
    }
    return map;
  }

  slotAt(x: number, y: number): ShipSlot | null {
    const id = this.occupancy.get(keyOf(x, y));
    return id === undefined
      ? null
      : (this.slots.find((slot) => slot.id === id) ?? null);
  }

  /** Why a ship may not lie there (ignoring the ship itself when it moves). */
  check(
    placement: ShipPlacement,
    ignoreId: number | null,
  ): PlacementIssue | null {
    const cells = placementCells(placement);
    if (cells.some((cell) => !cell.inside(this.size))) return "out_of_bounds";
    const others = new Set<string>();
    for (const slot of this.placed) {
      if (slot.id === ignoreId) continue;
      for (const cell of placementCells(slot.placement as ShipPlacement)) {
        others.add(cell.key);
      }
    }
    if (cells.some((cell) => others.has(cell.key))) return "overlap";
    if (
      !this.rules.shipsMayTouch &&
      outlineOf(cells, this.size).some((cell) => others.has(cell.key))
    ) {
      return "touching";
    }
    return null;
  }

  /** The selected ship where it would land now (pointer, drag or cursor). */
  get preview(): Preview | null {
    const slot = this.selected;
    if (!slot || this.submitted) return null;
    let anchor: Cell | null = null;
    if (this.drag && this.pointer) {
      anchor = this.anchorFor(this.pointer, this.drag.grab);
    } else if (this.pointer) {
      anchor = this.pointer;
    } else if (this.cursorActive) {
      anchor = this.cursor;
    }
    if (!anchor) return null;
    const placement: ShipPlacement = {
      x: anchor.x,
      y: anchor.y,
      length: slot.length,
      orientation: this.orientation,
    };
    return {
      placement,
      cells: placementCells(placement)
        .filter((cell) => cell.inside(this.size))
        .map((cell) => ({ x: cell.x, y: cell.y })),
      issue: this.check(placement, slot.id),
    };
  }

  reset(): void {
    this.slots = createSlots(this.rules);
    this.selectedId = this.slots[0]?.id ?? null;
    this.orientation = "horizontal";
    this.cursor = { x: 0, y: 0 };
    this.pointer = null;
    this.drag = null;
    this.issue = null;
    this.lastPlaced = null;
    this.submitSeq = null;
    this.submitted = false;
    this.serverError = null;
  }

  select(id: number | null): void {
    if (this.submitted) return;
    this.selectedId = id;
    this.issue = null;
    const slot = this.selected;
    if (slot?.placement) this.orientation = slot.placement.orientation;
  }

  /** Picks the next unplaced ship of a length (keys 1–4). */
  selectLength(length: number): void {
    const slot =
      this.hand.find((item) => item.length === length) ??
      this.placed.find((item) => item.length === length);
    if (slot) this.select(slot.id);
  }

  /** Turns the selected ship; a ship on the board turns in place when it fits. */
  rotate(): void {
    if (this.submitted) return;
    const next: Orientation =
      this.orientation === "horizontal" ? "vertical" : "horizontal";
    const slot = this.selected;
    if (slot?.placement) {
      const turned = { ...slot.placement, orientation: next };
      const issue = this.check(turned, slot.id);
      if (issue) {
        this.issue = issue;
        return;
      }
      slot.placement = turned;
    }
    this.orientation = next;
    this.issue = null;
  }

  /** Puts the selected ship with its first cell at `anchor`. */
  place(anchor: Cell): boolean {
    const slot = this.selected;
    if (!slot || this.submitted) return false;
    const placement: ShipPlacement = {
      x: anchor.x,
      y: anchor.y,
      length: slot.length,
      orientation: this.orientation,
    };
    const issue = this.check(placement, slot.id);
    if (issue) {
      this.issue = issue;
      return false;
    }
    slot.placement = placement;
    this.lastPlaced = placement;
    this.issue = null;
    this.serverError = null;
    this.selectedId = this.hand[0]?.id ?? null;
    return true;
  }

  /**
   * A click, tap or Enter on a cell: place the selected ship there, turn it
   * when the cell is the selected ship itself, or pick up the ship there.
   */
  activateCell(x: number, y: number): void {
    if (this.submitted) return;
    this.cursor = { x, y };
    const selected = this.selected;
    const here = this.slotAt(x, y);
    if (selected?.placement && here?.id === selected.id) {
      this.rotate();
      return;
    }
    if (selected && (!here || here.id === selected.id)) {
      this.place({ x, y });
      return;
    }
    if (here) this.select(here.id);
    else if (selected) this.place({ x, y });
  }

  /** Takes a ship off the board back into the tray (Delete key). */
  removeAt(x: number, y: number): void {
    const slot = this.slotAt(x, y);
    if (!slot || this.submitted) return;
    slot.placement = null;
    this.select(slot.id);
  }

  randomize(): void {
    if (this.submitted) return;
    const placements = new RandomPlacement(this.random).place(this.rules);
    const byLength = [...this.slots].sort((a, b) => b.length - a.length);
    const pool = [...placements];
    for (const slot of byLength) {
      const index = pool.findIndex((item) => item.length === slot.length);
      slot.placement = index >= 0 ? (pool.splice(index, 1)[0] ?? null) : null;
    }
    this.selectedId = null;
    this.issue = null;
    this.serverError = null;
  }

  clear(): void {
    if (this.submitted) return;
    for (const slot of this.slots) slot.placement = null;
    this.selectedId = this.slots[0]?.id ?? null;
    this.orientation = "horizontal";
    this.issue = null;
    this.serverError = null;
  }

  moveCursor(dx: number, dy: number): void {
    this.cursor = {
      x: Math.min(this.size - 1, Math.max(0, this.cursor.x + dx)),
      y: Math.min(this.size - 1, Math.max(0, this.cursor.y + dy)),
    };
  }

  setCursor(cell: Cell): void {
    this.cursor = cell;
  }

  setCursorActive(active: boolean): void {
    this.cursorActive = active;
  }

  setPointer(cell: Cell | null): void {
    this.pointer = cell;
  }

  beginDrag(id: number, grab: number): void {
    if (this.submitted) return;
    this.select(id);
    this.drag = { id, grab: Math.max(0, grab) };
  }

  /** Drops the dragged ship on a cell; off the board it stays where it was. */
  endDrag(cell: Cell | null): boolean {
    const drag = this.drag;
    this.drag = null;
    this.pointer = null;
    if (!drag || !cell) return false;
    return this.place(this.anchorFor(cell, drag.grab));
  }

  cancelDrag(): void {
    this.drag = null;
    this.pointer = null;
  }

  submit(): boolean {
    if (!this.canSubmit) return false;
    this.serverError = null;
    this.submitSeq = this.sender.send("fleet.place", { ships: this.fleet });
    return this.submitSeq !== null;
  }

  /** After a snapshot: a placed fleet comes back from the server's own view. */
  syncFromSnapshot(match: MatchSnapshot): void {
    if (!match.yourFleetPlaced || !match.own) return;
    const pool = match.own.ships.map(({ x, y, length, orientation }) => ({
      x,
      y,
      length,
      orientation,
    }));
    const slots = createSlots(this.rules);
    for (const slot of slots) {
      const index = pool.findIndex((item) => item.length === slot.length);
      if (index >= 0) slot.placement = pool.splice(index, 1)[0] ?? null;
    }
    this.slots = slots;
    this.selectedId = null;
    this.submitted = true;
    this.submitSeq = null;
  }

  handle(message: ServerMessage): void {
    if (message.type === "fleet.placed" && message.payload.side === "you") {
      this.submitted = true;
      this.submitSeq = null;
      this.selectedId = null;
    } else if (
      message.type === "error" &&
      this.submitSeq !== null &&
      message.payload.ref === this.submitSeq
    ) {
      this.serverError = message.payload.code;
      this.submitSeq = null;
    }
  }

  private anchorFor(cell: Cell, grab: number): Cell {
    return this.orientation === "horizontal"
      ? { x: cell.x - grab, y: cell.y }
      : { x: cell.x, y: cell.y - grab };
  }
}

/** Board coordinate label, e.g. {x: 1, y: 6} → "B7". */
export function cellLabel(x: number, y: number): string {
  return Coordinate.of(x, y).label;
}
