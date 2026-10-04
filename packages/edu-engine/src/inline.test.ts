import type { Inline } from "@outegro/contracts/edu";
import { describe, expect, it } from "vitest";
import { labelText, safeHref } from "./inline.js";

describe("links in a book", () => {
  it("lead to https pages, opened in a new tab", () => {
    expect(safeHref("https://sqlite.org")).toEqual({
      href: "https://sqlite.org/",
      external: true,
    });
    expect(safeHref("https://nodejs.org/api/fs.html#readfile")).toEqual({
      href: "https://nodejs.org/api/fs.html#readfile",
      external: true,
    });
  });

  it("or to an anchor on the same page", () => {
    expect(safeHref("#s01-keys")).toEqual({
      href: "#s01-keys",
      external: false,
    });
  });

  it("and nowhere else", () => {
    for (const href of [
      "javascript:void(0)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "http://example.com",
      "data:text/html,<b>x</b>",
      "//evil.example",
      "https://user:secret@example.com",
      "https://exa mple.com",
      "https://example.com\\evil",
      "#",
      "#1abc",
      "vbscript:x",
      `https://example.com/${"a".repeat(2050)}`,
      42,
      null,
    ])
      expect(safeHref(href), String(href)).toBeNull();
  });
});

describe("label text", () => {
  it("reads inline text as plain words on one line", () => {
    expect(
      labelText([
        "Колбэк ",
        { t: "code", v: ".then" },
        { t: "br" },
        "встаёт ",
        { t: "b", c: ["в ", { t: "i", c: ["очередь"] }] },
      ] as Inline[]),
    ).toBe("Колбэк .then встаёт в очередь");
  });

  it("is empty for nothing", () => {
    expect(labelText(null)).toBe("");
    expect(labelText([])).toBe("");
    expect(labelText(["  ", { t: "br" }, " "])).toBe("");
  });
});
