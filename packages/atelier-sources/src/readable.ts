import {
  attr,
  byTag,
  findAll,
  findFirst,
  type HtmlNode,
  isElement,
  nodesToText,
  parseHtml,
  SKIP,
} from "./html.js";

/**
 * The main text of a page, the way trafilatura or Readability find it:
 * navigation, headers, footers, forms and link lists are dropped, text
 * blocks score their parents, and the best container (with its strong
 * siblings) is turned into text.
 */
export function mainText(html: string | HtmlNode): string {
  const root = typeof html === "string" ? parseHtml(html) : html;
  const body = findFirst(root, byTag("body")) ?? root;
  const scope =
    findAll(
      body,
      (node) =>
        node.name === "main" ||
        node.name === "article" ||
        attr(node, "role") === "main",
    ).find((node) => contentLength(node) >= 250) ?? body;
  const best = bestContainer(scope);
  return nodesToText(best.length ? best : [scope]);
}

const NOISE_TAGS = new Set([
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "dialog",
  "menu",
  "label",
]);
const NOISE_ROLES = new Set([
  "navigation",
  "banner",
  "contentinfo",
  "dialog",
  "search",
  "complementary",
  "menu",
  "menubar",
]);
const NOISE_NAMES =
  /(?:^|[\s_-])(?:nav|navbar|navigation|menu|footer|cookies?|consent|gdpr|sidebar|share|sharing|social|breadcrumbs?|subscribe|newsletter|modal|popup|related|similar|recommend\w*|advert\w*|promo|banner|skip-link)(?:$|[\s_-])/i;

function isNoise(node: HtmlNode): boolean {
  const name = node.name ?? "";
  if (SKIP.has(name) || NOISE_TAGS.has(name)) return true;
  if (NOISE_ROLES.has(attr(node, "role") ?? "")) return true;
  if (
    attr(node, "aria-hidden") === "true" ||
    attr(node, "hidden") !== undefined
  )
    return true;
  const label = `${attr(node, "id") ?? ""} ${attr(node, "class") ?? ""}`;
  return NOISE_NAMES.test(label);
}

const measured = new WeakMap<HtmlNode, { text: number; links: number }>();

/** Visible text length without noise, links counted apart. */
function measure(node: HtmlNode): { text: number; links: number } {
  const known = measured.get(node);
  if (known) return known;
  const result = measureNode(node);
  measured.set(node, result);
  return result;
}

function measureNode(node: HtmlNode): { text: number; links: number } {
  if (node.type === "text") {
    const length = (node.data ?? "").replace(/\s+/g, " ").trim().length;
    return { text: length, links: 0 };
  }
  if (!isElement(node) || isNoise(node)) return { text: 0, links: 0 };
  let text = 0;
  let links = 0;
  for (const child of node.children ?? []) {
    const inner = measure(child);
    text += inner.text;
    links += inner.links;
  }
  if (node.name === "a") links = text;
  return { text, links };
}

const contentLength = (node: HtmlNode) => {
  const { text, links } = measure(node);
  return text - links;
};

const BLOCK_TAGS = new Set([
  "p",
  "li",
  "pre",
  "td",
  "blockquote",
  "dd",
  "h2",
  "h3",
  "h4",
]);

function bestContainer(scope: HtmlNode): HtmlNode[] {
  const scores = new Map<HtmlNode, number>();
  const visit = (node: HtmlNode) => {
    if (!isElement(node) || isNoise(node)) return;
    const name = node.name ?? "";
    const leafDiv =
      name === "div" &&
      !(node.children ?? []).some(
        (child) =>
          isElement(child) &&
          !["a", "b", "strong", "em", "i", "span", "br"].includes(
            child.name ?? "",
          ),
      );
    if (BLOCK_TAGS.has(name) || leafDiv) {
      const { text, links } = measure(node);
      if (text >= 25 && links / Math.max(text, 1) < 0.5) {
        const commas = (nodesToText([node]).match(/[,;]/g) ?? []).length;
        const score = 1 + commas + Math.min(3, Math.floor(text / 100));
        let parent = node.parent ?? null;
        let weight = 1;
        for (let level = 0; parent && level < 3; level++) {
          scores.set(parent, (scores.get(parent) ?? 0) + score * weight);
          if (parent === scope) break;
          parent = parent.parent ?? null;
          weight /= 2;
        }
      }
      if (BLOCK_TAGS.has(name)) return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(scope);
  let top: HtmlNode | null = null;
  let topScore = 0;
  for (const [node, score] of scores) {
    const { text, links } = measure(node);
    const adjusted = score * (1 - links / Math.max(text, 1));
    if (adjusted > topScore) {
      top = node;
      topScore = adjusted;
    }
  }
  if (!top) return [];
  // Strong siblings (another section of the same vacancy) come along.
  const parent = top.parent;
  if (!parent || top === scope) return [top];
  const keep = (parent.children ?? []).filter((sibling) => {
    if (sibling === top) return true;
    if (!isElement(sibling) || isNoise(sibling)) return false;
    const score = scores.get(sibling) ?? 0;
    if (score >= topScore * 0.2) return true;
    const { text, links } = measure(sibling);
    return sibling.name === "p" && text > 80 && links / text < 0.25;
  });
  return keep;
}

/** Drops what job boards put after a vacancy: lists of other jobs, share blocks. */
export function cutTail(text: string): string {
  return (
    text.split(
      /\n(?:Similar (?:Jobs|Vacancies|positions)|Related Jobs|More jobs(?: at| from)?[^\n]{0,40}|Other jobs[^\n]{0,40}|Похожие вакансии|Другие вакансии[^\n]{0,40}|Share this job|Поделиться вакансией)\n/i,
    )[0] ?? text
  ).trim();
}

/** hirify.me around the vacancy: its rating, AI summary and warnings (port of Work Finder). */
export function cutHirify(text: string): string {
  let result = text;
  const marker = result.indexOf("\nJob description\n");
  if (marker >= 0) result = result.slice(marker + "\nJob description\n".length);
  const summary = result.indexOf("\nTL;DR\n");
  if (summary >= 0) {
    const end = result.indexOf("\n\n", summary + 7);
    if (end >= 0) result = result.slice(end + 2);
  }
  result =
    result.split(
      /\n(?:Будьте осторожны|Be careful|Текст вакансии взят без изменений|Job description taken|опубликована в|Контакт:|Contact:)/,
    )[0] ?? result;
  return cutTail(result.replace(/Показать контакты|Show contacts/g, "")).trim();
}
