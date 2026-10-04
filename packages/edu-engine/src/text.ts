import type { Block, Chapter, Inline } from "@outegro/contracts/edu";

/*
 * Plain text of a book: what the assistant is given as the reading the
 * reader is asking about. It follows what a reader sees in a section or a
 * chapter; exercises, cards and recaps stay out (they would hand the model
 * the answers), code and figures are kept in short form.
 */

/** Inline nodes as plain text; code keeps backticks. */
export function plainText(inlines: readonly Inline[]): string {
  return inlines
    .map((node) => {
      if (typeof node === "string") return node;
      if (node.t === "code") return `\`${node.v}\``;
      if (node.t === "br") return "\n";
      return plainText(node.c);
    })
    .join("");
}

const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

/** Top-level sections of a chapter: its h3 anchors and titles. */
export function sectionsOf(chapter: Pick<Chapter, "blocks">) {
  return chapter.blocks.flatMap((block) =>
    block.t === "h3"
      ? [{ id: block.id, title: squeeze(plainText(block.c)) }]
      : [],
  );
}

const SKIPPED = new Set<Block["t"]>([
  "quiz",
  "order",
  "sort",
  "sqlTask",
  "cards",
  "eventLoop",
  "schema",
]);

/** One block as reading text; null for blocks the assistant does not need. */
function blockText(block: Block, codeLimit: number): string | null {
  if (SKIPPED.has(block.t)) return null;
  switch (block.t) {
    case "p":
      return squeeze(plainText(block.c));
    case "h3":
      return `## ${squeeze(plainText(block.c))}`;
    case "h4":
      return `### ${squeeze(plainText(block.c))}`;
    case "ul":
    case "ol":
      return block.items
        .map((item, k) => {
          const text = item
            .map((inner) => blockText(inner, codeLimit))
            .filter(Boolean)
            .join(" ");
          return `${block.t === "ol" ? `${k + 1}.` : "-"} ${text}`;
        })
        .join("\n");
    case "code": {
      const code = block.code.slice(0, codeLimit);
      const out = block.out ? `\nВывод:\n${block.out.slice(0, codeLimit)}` : "";
      return `\`\`\`${block.lang ?? ""}\n${code}\n\`\`\`${out}`;
    }
    case "out":
      return `Вывод:\n${block.text.slice(0, codeLimit)}`;
    case "figure":
      return `[Рисунок: ${squeeze(plainText(block.caption))}]`;
    case "table":
      return [block.head, ...block.rows]
        .filter((row) => row.length)
        .map((row) => row.map((cell) => squeeze(plainText(cell))).join(" | "))
        .join("\n");
    case "note":
      return [
        block.title,
        ...block.body.map((inner) => blockText(inner, codeLimit)),
      ]
        .filter(Boolean)
        .join(": ");
    case "recap":
      return null;
    case "details":
      return [
        squeeze(plainText(block.summary)),
        ...block.body.map((inner) => blockText(inner, codeLimit)),
      ]
        .filter(Boolean)
        .join("\n");
    case "explain":
      return `[Блок объяснений: ${block.topic}]`;
    case "sqlPlay":
      return `\`\`\`sql\n${block.sql.slice(0, codeLimit)}\n\`\`\``;
    default:
      return null;
  }
}

/** A section: from its h3 up to the next h3, at most `limit` characters. */
export function sectionText(
  chapter: Pick<Chapter, "blocks">,
  sectionId: string,
  limit = 9000,
): string | null {
  const start = chapter.blocks.findIndex(
    (block) => block.t === "h3" && block.id === sectionId,
  );
  if (start < 0) return null;
  const parts: string[] = [];
  for (const block of chapter.blocks.slice(start + 1)) {
    if (block.t === "h3") break;
    const text = blockText(block, 4000);
    if (text) parts.push(text);
  }
  return parts.join("\n\n").slice(0, limit);
}

/** A whole chapter, shortened: section titles, prose, short code. */
export function chapterText(
  chapter: Pick<Chapter, "blocks" | "title" | "lead">,
  limit = 14000,
): string {
  const parts = [`# ${chapter.title}`, squeeze(plainText(chapter.lead))];
  for (const block of chapter.blocks) {
    if (block.t === "explain") continue;
    const text = blockText(block, 600);
    if (text) parts.push(text);
  }
  return parts.join("\n").slice(0, limit);
}
