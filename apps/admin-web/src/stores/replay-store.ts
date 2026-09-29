import { makeAutoObservable } from "mobx";
import { type Board, boardAt, type Placement, type Shot } from "@/lib/board";

/**
 * Step-through of a match: both boards after any number of moves. The
 * boards are derived; the only state is the current step.
 */
export class ReplayStore {
  step: number;

  constructor(
    readonly fleets: { a: Placement[] | null; b: Placement[] | null },
    readonly moves: readonly Shot[],
  ) {
    this.step = moves.length;
    makeAutoObservable<ReplayStore, "fleets" | "moves">(this, {
      fleets: false,
      moves: false,
    });
  }

  get total(): number {
    return this.moves.length;
  }

  get boardA(): Board {
    return boardAt("a", this.fleets.a, this.moves, this.step);
  }

  get boardB(): Board {
    return boardAt("b", this.fleets.b, this.moves, this.step);
  }

  /** The move shown last, or null at the start. */
  get current(): Shot | null {
    return this.step > 0 ? (this.moves[this.step - 1] ?? null) : null;
  }

  get atStart(): boolean {
    return this.step === 0;
  }

  get atEnd(): boolean {
    return this.step === this.moves.length;
  }

  goTo(step: number): void {
    this.step = Math.min(this.moves.length, Math.max(0, Math.round(step)));
  }

  first(): void {
    this.goTo(0);
  }

  previous(): void {
    this.goTo(this.step - 1);
  }

  next(): void {
    this.goTo(this.step + 1);
  }

  last(): void {
    this.goTo(this.moves.length);
  }
}
