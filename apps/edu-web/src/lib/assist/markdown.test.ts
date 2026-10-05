import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type AnswerCodeLabels,
  AssistMarkdown,
} from "@/components/assist/markdown";
import { parseInline, parseMarkdown } from "./markdown";

const labels: AnswerCodeLabels = {
  language: (lang) => (lang === "js" ? "JavaScript" : lang || "Код"),
  copy: "Копировать",
  copied: "Скопировано",
  copyFailed: "Не скопировалось",
};

const render = (text: string) =>
  renderToStaticMarkup(createElement(AssistMarkdown, { text, labels }));

describe("the answer's Markdown subset", () => {
  it("paragraphs with line breaks, bold and inline code", () => {
    expect(
      parseMarkdown("Первая **строка**\nвторая `fs.readFile`\n\nДругой абзац"),
    ).toEqual([
      {
        t: "p",
        lines: [
          [
            { t: "text", v: "Первая " },
            { t: "b", c: [{ t: "text", v: "строка" }] },
          ],
          [
            { t: "text", v: "вторая " },
            { t: "code", v: "fs.readFile" },
          ],
        ],
      },
      { t: "p", lines: [[{ t: "text", v: "Другой абзац" }]] },
    ]);
  });

  it("bullet lists with - * • and numbered ones with 1. 1), continuation lines join the item", () => {
    const blocks = parseMarkdown(
      "- один\n* два\n  продолжение\n• три\n\n1. первый\n2) второй",
    );
    expect(blocks).toEqual([
      {
        t: "ul",
        items: [
          [{ t: "text", v: "один" }],
          [{ t: "text", v: "два продолжение" }],
          [{ t: "text", v: "три" }],
        ],
      },
      {
        t: "ol",
        start: 1,
        items: [[{ t: "text", v: "первый" }], [{ t: "text", v: "второй" }]],
      },
    ]);
  });

  it("a numbered list split by blank lines goes on counting", () => {
    expect(render("1. первый\n\n2. второй")).toBe(
      '<ol><li>первый</li></ol><ol start="2"><li>второй</li></ol>',
    );
  });

  it("headings become bold paragraphs; a bold marker is not a bullet", () => {
    expect(render("## Итог\n**Что верно** — всё.")).toBe(
      "<p><strong>Итог</strong></p><p><strong>Что верно</strong> — всё.</p>",
    );
  });

  it("fenced code: a block with its language, kept exactly", () => {
    const blocks = parseMarkdown(
      "Пример:\n```js\nconst a = 1;\n  // **не жирный**\n```\nПосле.",
    );
    expect(blocks[1]).toEqual({
      t: "code",
      lang: "js",
      code: "const a = 1;\n  // **не жирный**",
      open: false,
    });
    const html = render("```js\nconst a = '<b>';\n```");
    expect(html).toContain('<span class="code-title">JavaScript</span>');
    expect(html).toContain("<code>const a = &#x27;&lt;b&gt;&#x27;;</code>");
  });

  it("mid-stream: an unclosed fence is code so far, without a closing fence on its way", () => {
    expect(parseMarkdown("```sql\nSELECT 1\nFROM t\n``")).toEqual([
      { t: "code", lang: "sql", code: "SELECT 1\nFROM t", open: true },
    ]);
    expect(parseMarkdown("Текст\n```py")).toEqual([
      { t: "p", lines: [[{ t: "text", v: "Текст" }]] },
      { t: "code", lang: "py", code: "", open: true },
    ]);
    // An unclosed bold or code mark stays text until it closes.
    expect(parseInline("это **важ")).toEqual([{ t: "text", v: "это **важ" }]);
    expect(parseInline("вызов `fs.re")).toEqual([
      { t: "text", v: "вызов `fs.re" },
    ]);
  });

  it("never renders the model's HTML, scripts or links", () => {
    const html = render(
      [
        "<script>alert(1)</script>",
        '<img src=x onerror="alert(1)">',
        "[нажми](javascript:alert(1)) и https://example.com",
        "**<b>жирный</b>**",
        "`<iframe>`",
      ].join("\n\n"),
    );
    expect(html).not.toMatch(/<script|<img|<iframe|<a |href=|<b>/);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain(
      "[нажми](javascript:alert(1)) и https://example.com",
    );
    expect(html).toContain("<strong>&lt;b&gt;жирный&lt;/b&gt;</strong>");
    expect(html).toContain("<code>&lt;iframe&gt;</code>");
  });

  it("tables, quotes and rules stay text; empty input is nothing", () => {
    expect(render("| a | b |\n> цитата\n\n---\n\nдальше")).toBe(
      "<p>| a | b |<br/>&gt; цитата</p><p>дальше</p>",
    );
    expect(render("")).toBe("");
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});
