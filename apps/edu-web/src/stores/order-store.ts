import {
  type ItemMark,
  type OrderBlock,
  orderMark,
  orderScore,
  type Random,
  shuffledIndices,
} from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";
import type { AttemptStore } from "./attempt-store";

/** A control to focus next: an option, a placed item or "Try again". */
export type OrderFocus = `pool-${number}` | `picked-${number}` | "retry";

/** Where an exercise's shuffles come from. */
export type Shuffles = {
  /**
   * The first order: seeded by the page (a new seed per visit, sent with
   * it) and the exercise, so the server render and the browser agree.
   */
  first: Random;
  /** "Try again" reshuffles. */
  random: Random;
};

/**
 * Put the items in order: pick them one by one from the options into your
 * order (a placed item goes back on a second click). With the last one
 * placed, the order goes to the attempt (the server's verdict); where each
 * item belongs comes from the book and shows at once. Focus follows the
 * items, so the exercise works from the keyboard alone.
 */
export class OrderStore {
  /** Items not placed yet, in the order they are offered. */
  pool: number[];
  /** `picked[position]` is the item placed there. */
  picked: number[] = [];
  focus: OrderFocus | null = null;
  readonly order: OrderBlock;
  readonly attempt: AttemptStore;
  private readonly random: Random;

  constructor(order: OrderBlock, attempt: AttemptStore, shuffles: Shuffles) {
    this.order = order;
    this.attempt = attempt;
    this.random = shuffles.random;
    this.pool = shuffledIndices(order.items.length, shuffles.first);
    makeAutoObservable<this, "random">(
      this,
      { order: false, attempt: false, random: false },
      { autoBind: true },
    );
  }

  get total(): number {
    return this.order.items.length;
  }

  get score() {
    return orderScore(this.picked, this.total);
  }

  get complete(): boolean {
    return this.score.complete;
  }

  /** Once complete: whether the item at `position` is where it belongs. */
  stateAt(position: number): ItemMark | undefined {
    return orderMark(this.picked, position, this.total);
  }

  pick(index: number) {
    if (this.complete) return;
    const position = this.pool.indexOf(index);
    if (position === -1) return;
    this.pool = this.pool.filter((item) => item !== index);
    this.picked = [...this.picked, index];
    if (this.complete) {
      this.attempt.submit({ kind: "order", order: [...this.picked] });
      this.focus = "retry";
      return;
    }
    const next = this.pool[position] ?? this.pool[position - 1];
    this.focus = next === undefined ? null : `pool-${next}`;
  }

  unpick(position: number) {
    if (this.complete) return;
    const index = this.picked[position];
    if (index === undefined) return;
    this.picked = this.picked.filter((_, i) => i !== position);
    this.pool = [...this.pool, index];
    const next = this.picked[position] ?? this.picked[position - 1];
    this.focus = next === undefined ? `pool-${index}` : `picked-${next}`;
  }

  retry() {
    if (this.attempt.checking) return;
    this.pool = shuffledIndices(this.total, this.random);
    this.picked = [];
    this.attempt.clear();
    const first = this.pool[0];
    this.focus = first === undefined ? null : `pool-${first}`;
  }

  focusDone() {
    this.focus = null;
  }
}
