import type { Block, Card, Chapter } from "@outegro/contracts/edu";

/*
 * How a chapter's blocks nest: exercises and flash cards can sit inside
 * notes, explanations, lists and other exercises. edu-backend indexes a
 * chapter with these when it imports a book; edu-web reads the same tree.
 */

/** Calls `visit` for every block of a list, depth first. */
export function walkBlocks(
  list: readonly Block[],
  visit: (block: Block) => void,
) {
  for (const block of list) {
    visit(block);
    switch (block.t) {
      case "note":
      case "recap":
      case "details":
        walkBlocks(block.body, visit);
        break;
      case "explain":
        for (const view of block.views) walkBlocks(view.body, visit);
        break;
      case "ul":
      case "ol":
        for (const item of block.items) walkBlocks(item, visit);
        break;
      case "quiz":
      case "order":
      case "sort":
        walkBlocks(block.q, visit);
        walkBlocks(block.why, visit);
        break;
      case "sqlTask":
        walkBlocks(block.q, visit);
        break;
    }
  }
}

/** Ids of the exercises of a chapter that count towards progress. */
export function exerciseIdsOf(chapter: Pick<Chapter, "blocks">): string[] {
  const ids: string[] = [];
  walkBlocks(chapter.blocks, (block) => {
    if (
      block.t === "quiz" ||
      block.t === "order" ||
      block.t === "sort" ||
      block.t === "sqlTask"
    )
      ids.push(block.id);
  });
  return ids;
}

/** Flash cards of a chapter in reading order. */
export function cardsOf(chapter: Pick<Chapter, "blocks">): Card[] {
  const cards: Card[] = [];
  walkBlocks(chapter.blocks, (block) => {
    if (block.t === "cards") cards.push(...block.cards);
  });
  return cards;
}
