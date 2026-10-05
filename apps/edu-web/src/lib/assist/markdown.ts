/*
 * The assistant's answers are a small Markdown subset (the prompts ask for
 * it): paragraphs, line breaks, lists with "- * •" or "1. 1)", **bold**,
 * `inline code` and fenced code blocks. This parser turns it into a plain
 * tree that the renderer maps to React elements — model text is never
 * HTML. Headings degrade to bold paragraphs; links, tables, images and raw
 * HTML stay text. It works on any prefix of an answer, so the reader sees
 * the answer take shape as it streams: an unclosed fence is code so far.
 */

export type MdInline =
  | { t: "text"; v: string }
  | { t: "b"; c: MdInline[] }
  | { t: "code"; v: string };

export type MdBlock =
  /** Lines of one paragraph, shown with line breaks between them. */
  | { t: "p"; lines: MdInline[][] }
  /** A `#` heading, shown as a bold paragraph. */
  | { t: "heading"; c: MdInline[] }
  | { t: "ul"; items: MdInline[][] }
  /** `start`: the number of its first item (lists split by blank lines go on). */
  | { t: "ol"; start: number; items: MdInline[][] }
  /** `open`: the closing fence has not come (yet). */
  | { t: "code"; lang: string; code: string; open: boolean };

const FENCE_OPEN = /^\s*```\s*([\w+#.-]*)[^`]*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const CONTINUATION = /^\s{2,}\S/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
/** The start of a fence still arriving at the very end of an answer. */
const PARTIAL_FENCE = /\n\s*`{1,2}$/;

/** Inline marks of one line: `code` first, then **bold** in the text between. */
export function parseInline(text: string): MdInline[] {
  const nodes: MdInline[] = [];
  const parts = text.split(/(`[^`\n]+`)/g);
  parts.forEach((part, index) => {
    if (!part) return;
    if (index % 2 === 1) {
      nodes.push({ t: "code", v: part.slice(1, -1) });
      return;
    }
    const bold = /\*\*([^*\n]+?)\*\*/g;
    let last = 0;
    for (let match = bold.exec(part); match; match = bold.exec(part)) {
      if (match.index > last)
        nodes.push({ t: "text", v: part.slice(last, match.index) });
      nodes.push({ t: "b", c: [{ t: "text", v: match[1] ?? "" }] });
      last = bold.lastIndex;
    }
    if (last < part.length) nodes.push({ t: "text", v: part.slice(last) });
  });
  return nodes;
}

/** An answer (or the part of it streamed so far) as blocks. */
export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  let list: { t: "ul" | "ol"; start: number; items: string[] } | null = null;

  const endParagraph = () => {
    if (paragraph.length)
      blocks.push({ t: "p", lines: paragraph.map(parseInline) });
    paragraph = [];
  };
  const endList = () => {
    if (!list) return;
    const items = list.items.map(parseInline);
    blocks.push(
      list.t === "ol"
        ? { t: "ol", start: list.start, items }
        : { t: "ul", items },
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      endParagraph();
      endList();
      const code: string[] = [];
      let closed = false;
      for (i += 1; i < lines.length; i++) {
        const inner = lines[i] ?? "";
        if (FENCE_CLOSE.test(inner)) {
          closed = true;
          break;
        }
        code.push(inner);
      }
      let text = code.join("\n");
      // A closing fence on its way ("`" or "``" so far) is not code.
      if (!closed) text = text.replace(PARTIAL_FENCE, "");
      blocks.push({
        t: "code",
        lang: (fence[1] ?? "").toLowerCase(),
        code: text.replace(/\n+$/, ""),
        open: !closed,
      });
      continue;
    }
    if (line.trim() === "" || RULE.test(line)) {
      endParagraph();
      endList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      endList();
      blocks.push({ t: "heading", c: parseInline(heading[1]?.trim() ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      endParagraph();
      const kind = bullet ? "ul" : "ol";
      const current = list as { t: "ul" | "ol" } | null;
      if (current && current.t !== kind) endList();
      if (!list)
        list = {
          t: kind,
          start: numbered ? Number(numbered[1]) || 1 : 1,
          items: [],
        };
      list.items.push(((bullet ? bullet[1] : numbered?.[2]) ?? "").trim());
      continue;
    }
    if (list && CONTINUATION.test(line)) {
      const items: string[] = list.items;
      items[items.length - 1] =
        `${items[items.length - 1] ?? ""} ${line.trim()}`;
      continue;
    }
    endList();
    paragraph.push(line.trim());
  }
  endParagraph();
  endList();
  return blocks;
}
