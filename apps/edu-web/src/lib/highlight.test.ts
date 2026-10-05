import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  highlight,
  highlightLines,
  splitHighlightedLines,
} from "./highlight";

describe("highlighting", () => {
  it("knows only the languages the books use", () => {
    expect(highlight("const a = 1;", "js")).toContain("hljs-keyword");
    expect(highlight("SELECT 1", "sql")).toContain("hljs-keyword");
    expect(highlight("npm i", "bash")).not.toBeNull();
    expect(highlight('{"a": 1}', "json")).toContain("hljs-");
    expect(highlight("plain", "text")).toBeNull();
    expect(highlight("plain", undefined)).toBeNull();
    expect(highlight("fn main() {}", "rust")).toBeNull();
  });

  it("escapes the code it highlights", () => {
    expect(highlight("const a = '<b>';", "js")).toContain("&lt;b&gt;");
  });

  it("splits markup into well-formed lines", () => {
    const html = splitHighlightedLines(
      '<span class="hljs-comment">/* one\ntwo */</span>\nx',
    );
    expect(html).toEqual([
      '<span class="hljs-comment">/* one</span>',
      '<span class="hljs-comment">two */</span>',
      "x",
    ]);
  });

  it("returns one highlighted line per source line", () => {
    const code = ["const text = `first", "second`;", "", "console.log(text);"];
    const lines = highlightLines(code, "js");
    expect(lines).toHaveLength(code.length);
    for (const line of lines)
      expect(line.split("<span").length).toBe(line.split("</span>").length);
  });

  it("escapes plain text", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
