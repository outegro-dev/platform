import { readFileSync } from "node:fs";
import path from "node:path";
import type { Block, BookDocument, Inline } from "@outegro/contracts/edu";

/** The real books the fake platform serves, for answers and expectations. */
const content = path.resolve(__dirname, "../../../edu-backend/content/books");

const cache = new Map<string, BookDocument>();

export function book(slug: string): BookDocument {
  let document = cache.get(slug);
  if (!document) {
    document = JSON.parse(
      readFileSync(path.join(content, `${slug}.json`), "utf8"),
    ) as BookDocument;
    cache.set(slug, document);
  }
  return document;
}

export function chapter(slug: string, n: number) {
  const found = book(slug).chapters.find((item) => item.n === n);
  if (!found) throw new Error(`no chapter ${n} in ${slug}`);
  return found;
}

/** The top-level blocks of one type in a chapter, in reading order. */
export function blocksOf<T extends Block["t"]>(
  slug: string,
  n: number,
  type: T,
): Extract<Block, { t: T }>[] {
  return chapter(slug, n).blocks.filter(
    (block): block is Extract<Block, { t: T }> => block.t === type,
  );
}

/** Inline text as the page shows it (textContent). */
export function text(nodes: readonly Inline[]): string {
  return nodes
    .map((node) =>
      typeof node === "string"
        ? node
        : node.t === "code"
          ? node.v
          : "c" in node
            ? text(node.c)
            : "",
    )
    .join("");
}
