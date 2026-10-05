import {
  type ItemMark,
  type Random,
  type SortBlock,
  type SortBucketMark,
  shuffle,
  sortBucketMark,
  sortMark,
  sortScore,
} from "@outegro/edu-engine";
import { makeAutoObservable } from "mobx";
import type { AttemptStore } from "./attempt-store";
import type { Shuffles } from "./order-store";

/**
 * Sort the items into buckets: one choice per item, and the first choice
 * counts (a wrong one shows where the item belongs, from the book). With
 * every item placed, the placement goes to the attempt (the server's
 * verdict) and the explanation opens.
 */
export class SortStore {
  /** Items in the order they are shown. */
  order: number[];
  /** The bucket chosen first for each item. */
  answers = new Map<number, string>();
  focus: "first" | null = null;
  readonly sort: SortBlock;
  readonly attempt: AttemptStore;
  private readonly random: Random;

  constructor(sort: SortBlock, attempt: AttemptStore, shuffles: Shuffles) {
    this.sort = sort;
    this.attempt = attempt;
    this.random = shuffles.random;
    this.order = shuffle(
      sort.items.map((_, index) => index),
      shuffles.first,
    );
    makeAutoObservable<this, "random">(
      this,
      { sort: false, attempt: false, random: false },
      { autoBind: true },
    );
  }

  get score() {
    return sortScore(this.sort.items, Object.fromEntries(this.answers));
  }

  get started(): boolean {
    return this.answers.size > 0;
  }

  answerOf(item: number): string | undefined {
    return this.answers.get(item);
  }

  stateOf(item: number): ItemMark | undefined {
    return sortMark(this.sort.items[item], this.answers.get(item));
  }

  /** How a bucket button of an answered item looks. */
  markOf(item: number, bucket: string): SortBucketMark | undefined {
    return sortBucketMark(
      this.sort.items[item],
      this.answers.get(item),
      bucket,
    );
  }

  choose(item: number, bucket: string) {
    if (this.answers.has(item) || !this.sort.items[item]) return;
    this.answers.set(item, bucket);
    if (!this.score.complete) return;
    this.attempt.submit({
      kind: "sort",
      placement: this.sort.items.map(
        (_, index) => this.answers.get(index) ?? "",
      ),
    });
  }

  retry() {
    if (this.attempt.checking) return;
    this.order = shuffle(
      this.sort.items.map((_, index) => index),
      this.random,
    );
    this.answers.clear();
    this.attempt.clear();
    this.focus = "first";
  }

  focusDone() {
    this.focus = null;
  }
}
