// Converts an interactive textbook exported from a claude.ai artifact (one
// HTML page: chapters, figures, exercises, flash cards) into the typed book
// document of @outegro/contracts/edu, which edu-backend imports with its
// migrations. No HTML survives: text becomes inline nodes, figures become
// SVG with whitelisted elements and attributes, and anything unexpected
// stops the conversion instead of slipping through.
//
//   pnpm --filter @outegro/edu-backend content:import <book.html> <slug>
//
// writes content/books/<slug>.json; add the book to content/manifest.json
// once, then commit both. Run from apps/edu-backend.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { bookDocumentSchema } from "@outegro/contracts/edu";
import {
  isSafeSvg,
  isSafeSvgAttribute,
  isSvgElement,
  svgAttributeName,
} from "@outegro/edu-engine";
import * as du from "domutils";
import { parseDocument } from "htmlparser2";
import { addExpectations } from "./sql-expectations.mjs";

const [input, slug] = process.argv.slice(2);
if (!input || !slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error("usage: import-artifact.mjs <book.html> <slug>");
  process.exit(2);
}
const output = path.join("content", "books", `${slug}.json`);

/**
 * Sentences that describe the artifact rather than the book, replaced with
 * what is true on the platform.
 */
const platformText = new Map([
  [
    "Прогресс упражнений и карточек хранится в этом браузере.",
    "Прогресс упражнений и карточек сохраняется в вашем аккаунте outegro.",
  ],
  [
    "Exercise and card progress is stored in this browser.",
    "Exercise and card progress is saved to your outegro account.",
  ],
]);

const html = readFileSync(input, "utf8");
const doc = parseDocument(html);

const isTag = (n) => n.type === "tag" || n.type === "script";
const classes = (n) => (n.attribs?.class ?? "").split(/\s+/).filter(Boolean);
const has = (n, name) => classes(n).includes(name);
const kids = (n) => n.children.filter(isTag);
const find = (root, test) => du.findOne(test, root.children, true);
const findAll = (root, test) => du.findAll(test, root.children);
const text = (n) => du.textContent(n);
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 8);
const fail = (message, n) => {
  const where = n
    ? `<${n.name} class="${n.attribs?.class ?? ""}"> ${text(n).slice(0, 80)}`
    : "";
  throw new Error(`${message}: ${where}`);
};

/* ---------- inline ---------- */

const MARKS = {
  strong: "b",
  b: "b",
  em: "i",
  i: "i",
  dfn: "dfn",
  sup: "sup",
  sub: "sub",
  u: "u",
};

function inline(nodes) {
  const out = [];
  const push = (value) => {
    if (typeof value === "string") {
      if (!value) return;
      if (typeof out.at(-1) === "string") out[out.length - 1] += value;
      else out.push(value);
    } else out.push(value);
  };
  for (const n of nodes) {
    if (n.type === "text") push(n.data.replace(/\s+/g, " "));
    else if (n.type === "comment") continue;
    else if (n.name === "code") push({ t: "code", v: text(n) });
    else if (n.name === "br") push({ t: "br" });
    else if (MARKS[n.name]) push({ t: MARKS[n.name], c: inline(n.children) });
    else if (n.name === "a") {
      const href = n.attribs.href ?? "";
      if (!/^(https:\/\/|#)/.test(href)) fail("unsafe link", n);
      push({ t: "a", href, c: inline(n.children) });
    } else if (n.name === "span") for (const c of inline(n.children)) push(c);
    else fail("unexpected inline element", n);
  }
  return out;
}

function trim(list) {
  const out = list.slice();
  if (typeof out[0] === "string") out[0] = out[0].replace(/^\s+/, "");
  const last = out.length - 1;
  if (typeof out[last] === "string") out[last] = out[last].replace(/\s+$/, "");
  return out.filter((x) => x !== "");
}
const inlineOf = (n) => trim(inline(n.children));

/* ---------- svg ---------- */

// One whitelist with edu-web, which checks the markup again before showing it
// (@outegro/edu-engine svg). Its check takes no raw < > or " inside an
// attribute value: escaped here, or edu-web would drop the figure.
const escapeAttr = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
const escapeText = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function svg(n) {
  if (n.type === "text") return escapeText(n.data.replace(/\s+/g, " "));
  if (n.type !== "tag") return "";
  if (!isSvgElement(n.name)) fail("unexpected svg element", n);
  let attrs = "";
  for (const [key, value] of Object.entries(n.attribs)) {
    // The HTML parser lowercases names (viewbox); the engine restores them.
    const name = svgAttributeName(key);
    if (!name) fail(`unexpected svg attribute ${key}`, n);
    // The root gets its namespace below, once.
    if (name === "xmlns") continue;
    if (!isSafeSvgAttribute(name, value))
      fail(`unsafe svg attribute ${key}`, n);
    attrs += ` ${name}="${escapeAttr(value)}"`;
  }
  const inner = n.children.map(svg).join("");
  if (n.name === "svg")
    return `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner.trim()}</svg>`;
  return `<${n.name}${attrs}>${inner}</${n.name}>`;
}

/** A figure or the cover as the book keeps it: SVG that edu-web will show. */
function pictureOf(n) {
  const markup = svg(n);
  if (!isSafeSvg(markup)) fail("svg the reader would not show", n);
  return markup;
}

/* ---------- blocks ---------- */

// Exercise and card ids come from their text, so inserting a new exercise
// does not move the progress readers already have on the others.
let chapterId = "";
let usedIds = new Set();
function exerciseId(kind, seed) {
  let id = `${chapterId}-${kind}-${hash(seed)}`;
  if (usedIds.has(id)) {
    let k = 2;
    while (usedIds.has(`${id}-${k}`)) k++;
    id = `${id}-${k}`;
  }
  usedIds.add(id);
  return id;
}

const EXPLAIN = new Set([
  "analogy",
  "steps",
  "code",
  "picture",
  "interview",
  "confuse",
  "deep",
]);
const TONES = {
  note: "tip",
  trap: "trap",
  interview: "interview",
  deep: "deep",
};
const INLINE_TAGS = new Set(["code", "br", "a", "span", ...Object.keys(MARKS)]);

function blocks(nodes) {
  const out = [];
  let loose = [];
  const flush = () => {
    const c = trim(inline(loose));
    if (c.length) out.push({ t: "p", c });
    loose = [];
  };
  const list = nodes.filter((n) => n.type !== "comment");
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    if (n.type === "text" || (n.type === "tag" && INLINE_TAGS.has(n.name))) {
      loose.push(n);
      continue;
    }
    flush();
    if (!isTag(n)) continue;
    const result = block(n, list, i);
    if (result) out.push(result);
  }
  flush();
  return out;
}

function nextTagAfter(list, i) {
  for (let k = i + 1; k < list.length; k++) {
    const n = list[k];
    if (n.type === "text" && !n.data.trim()) continue;
    return { node: n, index: k };
  }
  return null;
}

function block(n, list, i) {
  switch (n.name) {
    case "p":
      return { t: "p", c: inlineOf(n) };
    case "h3":
      return {
        t: "h3",
        id: n.attribs.id ?? fail("h3 without id", n),
        c: inlineOf(n),
      };
    case "h4":
      return n.attribs.id
        ? { t: "h4", id: n.attribs.id, c: inlineOf(n) }
        : { t: "h4", c: inlineOf(n) };
    case "ul":
    case "ol":
      return {
        t: n.name,
        items: kids(n).map((li) =>
          li.name === "li" ? blocks(li.children) : fail("list child", li),
        ),
      };
    case "pre": {
      const codeOf = (pre) =>
        text(find(pre, (x) => x.name === "code") ?? pre).replace(/\n$/, "");
      if (has(n, "code")) {
        const result = { t: "code", code: codeOf(n) };
        if (n.attribs["data-lang"]) result.lang = n.attribs["data-lang"];
        if (n.attribs["data-title"]) result.title = n.attribs["data-title"];
        // An output right after the code belongs to it.
        const next = nextTagAfter(list, i);
        if (next?.node.name === "pre" && has(next.node, "out")) {
          result.out = codeOf(next.node);
          for (let k = i + 1; k <= next.index; k++)
            list[k] = { type: "comment" };
        }
        return result;
      }
      if (has(n, "out")) return { t: "out", text: codeOf(n) };
      return fail("unknown pre", n);
    }
    case "figure": {
      const picture =
        find(n, (x) => x.name === "svg") ?? fail("figure without svg", n);
      const caption = find(n, (x) => x.name === "figcaption");
      return {
        t: "figure",
        svg: pictureOf(picture),
        caption: caption ? inlineOf(caption) : [],
      };
    }
    case "aside": {
      const tone =
        classes(n)
          .map((c) => TONES[c])
          .filter(Boolean)
          .at(-1) ?? fail("note without tone", n);
      const title = find(n, (x) => has(x, "note-t"));
      return {
        t: "note",
        tone,
        title: title ? text(title).trim() : "",
        body: blocks(n.children.filter((x) => x !== title)),
      };
    }
    case "details": {
      const summary =
        find(n, (x) => x.name === "summary") ??
        fail("details without summary", n);
      return {
        t: "details",
        summary: inlineOf(summary),
        body: blocks(n.children.filter((x) => x !== summary)),
      };
    }
    case "table":
      return table(n);
    case "div":
      return div(n);
    default:
      return fail("unexpected block element", n);
  }
}

function table(t) {
  const rows = (section) =>
    findAll(t, (x) => x.name === section).flatMap((s) =>
      findAll(s, (x) => x.name === "tr"),
    );
  const cells = (tr) => kids(tr).map(inlineOf);
  const head = rows("thead");
  return {
    t: "table",
    head: head[0] ? cells(head[0]) : [],
    rows: rows("tbody").map(cells),
  };
}

function div(n) {
  const child = (name) => find(n, (x) => has(x, name));
  const others = (...skip) => n.children.filter((x) => !skip.includes(x));
  if (has(n, "tbl"))
    return table(find(n, (x) => x.name === "table") ?? fail("tbl", n));
  if (has(n, "recap")) {
    const title = child("recap-t");
    return {
      t: "recap",
      title: title ? text(title).trim() : "",
      body: blocks(others(title)),
    };
  }
  if (has(n, "explain")) {
    return {
      t: "explain",
      topic: n.attribs["data-topic"] ?? "",
      views: kids(n).map((view) => {
        const kind = view.attribs["data-kind"];
        if (!EXPLAIN.has(kind)) fail(`explain kind ${kind}`, view);
        return { kind, body: blocks(view.children) };
      }),
    };
  }
  if (has(n, "quiz")) {
    const options = child("quiz-opts") ?? fail("quiz without options", n);
    const why = child("quiz-why");
    const answer = (n.attribs["data-answer"] ?? "0").split(",").map(Number);
    const list = kids(options).map(inlineOf);
    if (answer.some((a) => !(a >= 0 && a < list.length)))
      fail("quiz answer out of range", n);
    return {
      t: "quiz",
      id: exerciseId("q", text(n)),
      q: blocks(others(options, why)),
      options: list,
      answer,
      why: why ? blocks(why.children) : [],
    };
  }
  if (has(n, "order-task")) {
    const items = child("order-items") ?? fail("order without items", n);
    const why = child("order-why");
    return {
      t: "order",
      id: exerciseId("o", text(n)),
      q: blocks(others(items, why)),
      items: kids(items).map(inlineOf),
      why: why ? blocks(why.children) : [],
    };
  }
  if (has(n, "sort-task")) {
    const buckets = child("sort-buckets") ?? fail("sort without buckets", n);
    const items = child("sort-items") ?? fail("sort without items", n);
    const why = child("sort-why");
    const keyed = (list) =>
      kids(list).map((li) => ({
        key: li.attribs["data-key"] ?? fail("sort item without key", li),
        c: inlineOf(li),
      }));
    const result = {
      t: "sort",
      id: exerciseId("s", text(n)),
      q: blocks(others(buckets, items, why)),
      buckets: keyed(buckets),
      items: keyed(items),
      why: why ? blocks(why.children) : [],
    };
    const keys = new Set(result.buckets.map((b) => b.key));
    if (result.items.some((item) => !keys.has(item.key)))
      fail("sort item without bucket", n);
    return result;
  }
  if (has(n, "cards")) {
    return {
      t: "cards",
      cards: kids(n).map((card) => {
        const front = find(card, (x) => has(x, "card-f"));
        const back = find(card, (x) => has(x, "card-b"));
        if (!front || !back) fail("card without two sides", card);
        return {
          id: exerciseId("c", text(front)),
          front: inlineOf(front),
          back: inlineOf(back),
        };
      }),
    };
  }
  if (has(n, "sql-play")) return { t: "sqlPlay", sql: text(n).trim() };
  if (has(n, "sql-task")) {
    const hint = child("task-hint");
    const solution =
      child("task-solution") ?? fail("sql task without solution", n);
    return {
      t: "sqlTask",
      id: exerciseId("t", text(n)),
      q: blocks(others(hint, solution)),
      hint: hint ? inlineOf(hint) : null,
      solution: text(solution).trim(),
      ordered: "data-ordered" in n.attribs,
    };
  }
  if (has(n, "el-sim")) return { t: "eventLoop" };
  if (has(n, "schema")) return { t: "schema" };
  return fail("unknown block", n);
}

/* ---------- book ---------- */

const hero = find(doc, (x) => has(x, "hero")) ?? fail("no hero");
const accent = /--accent:(#[0-9A-Fa-f]{6})/.exec(html)?.[1];
const accentDark =
  /prefers-color-scheme: dark[\s\S]*?--accent:(#[0-9A-Fa-f]{6})/.exec(
    html,
  )?.[1];
if (!accent || !accentDark) fail("no accent colours");

const book = {
  schemaVersion: 1,
  slug,
  locale: "ru",
  title: text(find(hero, (x) => x.name === "h1")).trim(),
  kicker: text(find(hero, (x) => has(x, "hero-kicker"))).trim(),
  lead: inlineOf(find(hero, (x) => has(x, "hero-lead"))),
  cover: pictureOf(find(hero, (x) => x.name === "svg") ?? fail("no cover")),
  theme: { accent, accentDark },
  chapters: [],
};

for (const section of findAll(doc, (x) => x.name === "section")) {
  chapterId = section.attribs.id;
  usedIds = new Set();
  if (has(section, "pre-sec")) {
    const kicker = find(section, (x) => has(x, "ch-kicker"));
    const title = find(section, (x) => x.name === "h2");
    book.preface = {
      id: chapterId,
      kicker: text(kicker).trim(),
      title: text(title).trim(),
      blocks: blocks(
        section.children.filter((x) => x !== kicker && x !== title),
      ),
    };
  } else if (has(section, "chapter")) {
    const head =
      find(section, (x) => has(x, "ch-head")) ??
      fail("chapter without head", section);
    book.chapters.push({
      id: chapterId,
      n: book.chapters.length + 1,
      short: section.attribs["data-short"],
      kicker: text(find(head, (x) => has(x, "ch-kicker"))).trim(),
      title: text(find(head, (x) => x.name === "h2")).trim(),
      lead: inlineOf(find(head, (x) => has(x, "ch-lead"))),
      blocks: blocks(section.children.filter((x) => x !== head)),
    });
  } else if (has(section, "deck-sec")) {
    const kicker = find(section, (x) => has(x, "ch-kicker"));
    book.deck = {
      kicker: text(kicker).trim(),
      title: text(find(section, (x) => x.name === "h2")).trim(),
      intro: findAll(section, (x) => x.name === "p" && x !== kicker).map(
        inlineOf,
      ),
    };
  } else fail("unknown section", section);
}

const foot = find(doc, (x) => has(x, "foot"));
if (foot) {
  book.note = inlineOf(foot).map((part) => {
    if (typeof part !== "string") return part;
    let out = part;
    for (const [from, to] of platformText) out = out.replace(from, to);
    return out;
  });
}

const seed = find(doc, (x) => x.name === "script" && x.attribs.id === "seed");
if (seed) book.sandbox = { engine: "sqlite", seed: text(seed).trim() };

// The event loop simulator keeps its scenarios in the page script as a JS
// literal; evaluate just that literal, without any globals.
const extra = findAll(
  doc,
  (x) => x.name === "script" && !x.attribs.src && !x.attribs.type,
)
  .map(text)
  .find((source) => source.includes("const SC = ["));
if (extra) {
  const start = extra.indexOf("const SC = [") + "const SC = ".length;
  const end = extra.indexOf("\n  ];", start) + "\n  ]".length;
  const scenarios = vm.runInNewContext(
    `(${extra.slice(start, end)})`,
    Object.create(null),
    {
      timeout: 1000,
    },
  );
  book.eventLoop = {
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      code: scenario.code,
      steps: scenario.steps.map((step) => {
        const out = { ...step };
        if (step.note !== undefined)
          out.note = trim(inline(parseDocument(step.note).children));
        return out;
      }),
    })),
  };
}

/* ---------- stats and output ---------- */

function walk(list, visit) {
  for (const b of list) {
    visit(b);
    for (const key of ["body", "q", "why"])
      if (Array.isArray(b[key])) walk(b[key], visit);
    if (b.views) for (const view of b.views) walk(view.body, visit);
    if (b.t === "ul" || b.t === "ol")
      for (const item of b.items) walk(item, visit);
  }
}
const stats = {
  chapters: book.chapters.length,
  figures: 0,
  exercises: 0,
  explain: 0,
  sandboxes: 0,
  cards: 0,
};
for (const list of [
  ...book.chapters.map((c) => c.blocks),
  book.preface?.blocks ?? [],
])
  walk(list, (b) => {
    if (b.t === "figure") stats.figures++;
    if (["quiz", "order", "sort", "sqlTask"].includes(b.t)) stats.exercises++;
    if (b.t === "explain") stats.explain++;
    if (b.t === "sqlPlay") stats.sandboxes++;
    if (b.t === "cards") stats.cards += b.cards.length;
  });
book.stats = stats;

// What each SQL task's solution returns, for the server's check.
await addExpectations(book);

const parsed = bookDocumentSchema.safeParse(book);
if (!parsed.success) {
  console.error(JSON.stringify(parsed.error.issues.slice(0, 10), null, 2));
  process.exit(1);
}
writeFileSync(output, `${JSON.stringify(book, null, 1)}\n`);
console.log(`${output}: ${JSON.stringify(stats)}`);
