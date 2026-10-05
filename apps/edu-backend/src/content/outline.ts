import {
  type Block,
  type BookDocument,
  type Chapter,
} from "@outegro/contracts/edu";
import {
  cardsOf,
  type ExerciseBlock,
  exerciseIdsOf,
  isExercise,
  sectionsOf,
  walkBlocks,
} from "@outegro/edu-engine";
import type { BookMeta, ChapterSection } from "../db/schema.js";

/** True when a block of the list, nested ones included, passes `test`. */
export function someBlock(
  list: readonly Block[],
  test: (block: Block) => boolean,
): boolean {
  let found = false;
  walkBlocks(list, (block) => {
    found ||= test(block);
  });
  return found;
}

const sandboxBlocks: ReadonlySet<Block["t"]> = new Set([
  "sqlPlay",
  "sqlTask",
  "schema",
]);

/** The blocks run queries in, or describe, the book's SQL sandbox. */
export const usesSandbox = (blocks: readonly Block[]) =>
  someBlock(blocks, (block) => sandboxBlocks.has(block.t));

/** The blocks show the book's event loop simulator. */
export const usesEventLoop = (blocks: readonly Block[]) =>
  someBlock(blocks, (block) => block.t === "eventLoop");

/** The exercise with this id among the blocks, nested ones included; null if none. */
export function findExercise(
  blocks: readonly Block[],
  id: string,
): ExerciseBlock | null {
  let found: ExerciseBlock | null = null;
  walkBlocks(blocks, (block) => {
    if (!found && isExercise(block) && block.id === id) found = block;
  });
  return found;
}

/** Every document field the books row keeps besides its own columns. */
export function metaOf(document: BookDocument): BookMeta {
  return {
    kicker: document.kicker,
    lead: document.lead,
    cover: document.cover,
    theme: document.theme,
    preface: document.preface,
    deck: document.deck,
    note: document.note,
    sandbox: document.sandbox,
    eventLoop: document.eventLoop,
    stats: document.stats,
  };
}

/** A chapter row without its book: the document and what is derived from it. */
export function chapterRow(chapter: Chapter) {
  const cards = cardsOf(chapter);
  return {
    n: chapter.n,
    key: chapter.id,
    short: chapter.short,
    title: chapter.title,
    document: chapter,
    exerciseIds: exerciseIdsOf(chapter),
    cardIds: cards.map((card) => card.id),
    cards,
    // The same sections the assistant explains (h3 anchors and titles).
    sections: sectionsOf(chapter) satisfies ChapterSection[],
    usesEventLoop: usesEventLoop(chapter.blocks),
    usesSandbox: usesSandbox(chapter.blocks),
  };
}
