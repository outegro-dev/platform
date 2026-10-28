import { parseDocument } from "htmlparser2";

/** The part of an htmlparser2 node this package reads. */
export interface HtmlNode {
  type: string;
  name?: string;
  data?: string;
  attribs?: Record<string, string>;
  children?: HtmlNode[];
  parent?: HtmlNode | null;
}

export function parseHtml(html: string): HtmlNode {
  return parseDocument(html, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true,
  }) as unknown as HtmlNode;
}

export const isElement = (node: HtmlNode): boolean =>
  node.type === "tag" || node.type === "script" || node.type === "style";

export const attr = (node: HtmlNode, name: string): string | undefined =>
  node.attribs?.[name];

/** Depth-first, document order. */
export function* walk(node: HtmlNode): Generator<HtmlNode> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

export function findAll(
  root: HtmlNode,
  test: (node: HtmlNode) => boolean,
): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of walk(root))
    if (isElement(node) && test(node)) out.push(node);
  return out;
}

export function findFirst(
  root: HtmlNode,
  test: (node: HtmlNode) => boolean,
): HtmlNode | null {
  for (const node of walk(root)) if (isElement(node) && test(node)) return node;
  return null;
}

export const byTag =
  (...names: string[]) =>
  (node: HtmlNode) =>
    names.includes(node.name ?? "");

/** Raw text of a node (script bodies included). */
export function rawText(node: HtmlNode): string {
  if (node.type === "text" || node.type === "cdata") return node.data ?? "";
  return (node.children ?? []).map(rawText).join("");
}

/** Text of an inline node with whitespace collapsed. */
export function inlineText(node: HtmlNode): string {
  return clean(textOf(node));
}

function textOf(node: HtmlNode): string {
  if (node.type === "text") return node.data ?? "";
  if (!isElement(node) && node.type !== "root") return "";
  if (SKIP.has(node.name ?? "")) return "";
  return (node.children ?? []).map(textOf).join(" ");
}

const clean = (value: string) =>
  value.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/\s+/g, " ").trim();

/** Elements whose content is never vacancy text. */
export const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "head",
  "object",
  "canvas",
  "video",
  "audio",
  "picture",
  "img",
  "input",
  "select",
  "option",
  "textarea",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const PARAGRAPHS = new Set(["p", "blockquote", "pre", "table", "figure"]);
const BLOCKS = new Set([
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "ul",
  "ol",
  "dl",
  "dt",
  "dd",
  "tr",
  "thead",
  "tbody",
  "form",
  "fieldset",
  "address",
  "details",
  "summary",
  "figcaption",
  "hr",
  "body",
  "center",
]);

const BREAK = "\u0001";
const PARAGRAPH = "\u0002";
const BULLET = "\u0003";

function render(node: HtmlNode, out: string[]) {
  if (node.type === "text" || node.type === "cdata") {
    out.push((node.data ?? "").replace(/\s+/g, " "));
    return;
  }
  if (!isElement(node) && node.type !== "root") return;
  const name = node.name ?? "";
  if (SKIP.has(name)) return;
  if (name === "br") {
    out.push(BREAK);
    return;
  }
  const children = node.children ?? [];
  if (name === "li") {
    // <li><p>…</p></li> stays one bullet; a nested list keeps its own lines.
    const lines = nodesToText(children).split("\n").filter(Boolean);
    const own = lines.filter((line) => !line.startsWith("- ")).join(" ");
    const nested = lines.filter((line) => line.startsWith("- "));
    out.push(BREAK);
    if (own) out.push(BULLET, own.replaceAll("\n", " "), BREAK);
    if (nested.length) out.push(nested.join("\n"), BREAK);
    return;
  }
  if (HEADINGS.has(name) || PARAGRAPHS.has(name)) {
    out.push(PARAGRAPH);
    for (const child of children) render(child, out);
    out.push(PARAGRAPH);
    return;
  }
  if (BLOCKS.has(name)) {
    out.push(BREAK);
    for (const child of children) render(child, out);
    out.push(BREAK);
    return;
  }
  if (name === "td" || name === "th") {
    out.push(" ");
    for (const child of children) render(child, out);
    out.push(" ");
    return;
  }
  for (const child of children) render(child, out);
}

/**
 * HTML to plain text: paragraphs apart, list items as "- " lines, headings
 * on their own line. HTML shipped as escaped text (Webflow, Greenhouse
 * `content`) is converted too.
 */
export function htmlToText(html: string): string {
  const once = nodesToText([parseHtml(html)]);
  return /<(p|div|li|ul|h[1-6]|br|section|strong)\b[^>]*>/i.test(once)
    ? nodesToText([parseHtml(once)])
    : once;
}

export function nodesToText(nodes: HtmlNode[]): string {
  const out: string[] = [];
  for (const node of nodes) render(node, out);
  return tidy(
    out
      .join("")
      .replaceAll(PARAGRAPH, "\n\n")
      .replaceAll(BREAK, "\n")
      .replaceAll(BULLET, "- "),
  );
}

/** Normalises plain text: bullet glyphs, spaces, blank lines, tight lists. */
export function tidy(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      clean(line).replace(/^(?:[•●▪◦·∙‣⁃▸►✓✔➤]\s*|[-*–]\s+)(?=\S)/, "- "),
    )
    .filter((line) => line !== "-" && line !== "- ");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!line) {
      const previous = kept.at(-1);
      const next = lines.slice(index + 1).find((item) => item);
      // A blank line between two list items is dropped: lists stay tight.
      if (!previous || previous === "") continue;
      if (previous.startsWith("- ") && next?.startsWith("- ")) continue;
    }
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `<meta property|name=…>` content. */
export function metaContent(root: HtmlNode, key: string): string | null {
  const node = findFirst(
    root,
    (item) =>
      item.name === "meta" &&
      (attr(item, "property") === key || attr(item, "name") === key),
  );
  const value = node ? attr(node, "content")?.trim() : undefined;
  return value || null;
}

/** h1, else og:title, else <title>. */
export function pageTitle(root: HtmlNode): string | null {
  const h1 = findFirst(root, byTag("h1"));
  const fromH1 = h1 ? inlineText(h1) : "";
  if (fromH1) return fromH1.slice(0, 300);
  const og = metaContent(root, "og:title");
  if (og) return og.slice(0, 300);
  const title = findFirst(root, byTag("title"));
  const text = title ? inlineText(title) : "";
  return text ? text.slice(0, 300) : null;
}

/** Contents of `<script>` tags, optionally of one type. */
export function scripts(root: HtmlNode, type?: string): string[] {
  return findAll(
    root,
    (node) =>
      node.name === "script" &&
      (type === undefined || (attr(node, "type") ?? "").toLowerCase() === type),
  ).map(rawText);
}

/** Every absolute link target on the page. */
export function links(root: HtmlNode, base: string): string[] {
  const out = new Set<string>();
  for (const node of findAll(root, byTag("a"))) {
    const href = attr(node, "href");
    if (!href) continue;
    try {
      out.add(new URL(href, base).href);
    } catch {}
  }
  return [...out];
}
