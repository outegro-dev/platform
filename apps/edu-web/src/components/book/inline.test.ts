import type { Inline } from "@outegro/contracts/edu";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineText } from "./inline";

const render = (nodes: Inline[]) =>
  renderToStaticMarkup(createElement(InlineText, { nodes }));

describe("inline renderer", () => {
  it("maps every mark to its element", () => {
    expect(
      render([
        "a ",
        { t: "code", v: "fs.readFile" },
        { t: "b", c: ["bold"] },
        { t: "i", c: ["italic"] },
        { t: "dfn", c: ["term"] },
        { t: "sup", c: ["2"] },
        { t: "sub", c: ["n"] },
        { t: "u", c: ["under"] },
        { t: "br" },
      ]),
    ).toBe(
      "a <code>fs.readFile</code><strong>bold</strong><em>italic</em><dfn>term</dfn><sup>2</sup><sub>n</sub><u>under</u><br/>",
    );
  });

  it("nests marks", () => {
    expect(render([{ t: "b", c: ["x ", { t: "code", v: "y" }] }])).toBe(
      "<strong>x <code>y</code></strong>",
    );
  });

  it("escapes text: content is never markup", () => {
    const html = render([
      "<script>alert(1)</script>",
      { t: "code", v: "<img src=x onerror=alert(1)>" },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("never renders a javascript: link as a link", () => {
    const html = render([
      // The contract refuses such data; the renderer must not trust it.
      { t: "a", href: "javascript:alert(1)", c: ["click"] } as Inline,
    ]);
    expect(html).toBe("click");
    expect(html).not.toContain("<a");
  });

  it("refuses every link that is not https or an anchor", () => {
    for (const href of [
      "http://example.com",
      "data:text/html,<b>x</b>",
      "//evil.example",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "https://user:secret@example.com",
      "https://exa mple.com",
      "#",
      "vbscript:x",
    ]) {
      const html = render([{ t: "a", href, c: ["x"] } as Inline]);
      expect(html, href).toBe("x");
    }
  });

  it("opens https links in a new tab without an opener", () => {
    expect(
      render([{ t: "a", href: "https://nodejs.org/api/", c: ["docs"] }]),
    ).toBe(
      '<a href="https://nodejs.org/api/" target="_blank" rel="noopener noreferrer">docs</a>',
    );
  });

  it("keeps in-page anchors in the page", () => {
    expect(render([{ t: "a", href: "#n04-phases", c: ["phases"] }])).toBe(
      '<a href="#n04-phases">phases</a>',
    );
  });

  it("drops unknown marks instead of guessing", () => {
    expect(render([{ t: "script", c: ["x"] } as unknown as Inline])).toBe("");
  });
});
