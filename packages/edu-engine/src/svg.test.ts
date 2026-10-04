import { describe, expect, it } from "vitest";
import {
  isSafeSvg,
  isSafeSvgAttribute,
  isSafeSvgValue,
  isSvgElement,
  svgAttributeName,
  svgAttributes,
  svgElements,
} from "./svg.js";

const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">';
const wrap = (body: string) => `${head}${body}</svg>`;

describe("the SVG whitelist", () => {
  it("accepts the plain shapes, markers and text the books use", () => {
    expect(
      isSafeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" role="img" aria-label="x"><defs><marker id="m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"></path></marker></defs><line class="ln" x1="0" y1="0" x2="5" y2="5" marker-end="url(#m)"></line><text class="t t-m" x="1" y="2">a &amp; b<tspan class="t-b">c</tspan></text></svg>',
      ),
    ).toBe(true);
  });

  it("accepts what the importer keeps: dashes and opacity too", () => {
    expect(
      isSafeSvg(
        wrap(
          '<rect class="b" x="1" y="1" width="8" height="8" stroke-dasharray="4 3" opacity="0.6"></rect><circle cx="5" cy="5" r="2"/>',
        ),
      ),
    ).toBe(true);
  });

  it("refuses anything that could run or leave the page", () => {
    for (const body of [
      "<script>alert(1)</script>",
      '<rect onload="alert(1)" width="1" height="1"></rect>',
      '<a href="https://evil.example"><text>x</text></a>',
      '<image href="https://evil.example/x.png"></image>',
      '<rect style="fill:url(https://evil.example)"></rect>',
      '<path marker-end="url(javascript:alert(1))"></path>',
      '<path marker-end="url(https://evil.example#m)"></path>',
      '<path marker-end="none"></path>',
      '<rect class="b" opacity="url(data:x)"></rect>',
      "<foreignObject><div>x</div></foreignObject>",
      "<!-- comment -->",
      "<rect class='b' width=\"1\"></rect>",
      "<text>unclosed",
      '<rect width="1"/><use xlink:href="#x"></use>',
      "<text>a > b</text>",
    ]) {
      expect(isSafeSvg(wrap(body)), body).toBe(false);
    }
    expect(isSafeSvg('<svg viewBox="0 0 1 1"></svg><script></script>')).toBe(
      false,
    );
    expect(isSafeSvg("<g></g>")).toBe(false);
  });

  it("names attributes in SVG's own spelling, whatever the parser did to them", () => {
    expect(svgAttributeName("viewbox")).toBe("viewBox");
    expect(svgAttributeName("REFX")).toBe("refX");
    expect(svgAttributeName("markerwidth")).toBe("markerWidth");
    expect(svgAttributeName("stroke-dasharray")).toBe("stroke-dasharray");
    expect(svgAttributeName("onload")).toBeNull();
    expect(svgAttributeName("style")).toBeNull();
    expect(svgAttributeName("href")).toBeNull();
  });

  it("checks one attribute and one value at a time", () => {
    expect(isSafeSvgAttribute("marker-end", "url(#arrow)")).toBe(true);
    expect(isSafeSvgAttribute("marker-end", "#arrow")).toBe(false);
    expect(isSafeSvgAttribute("viewbox", "0 0 1 1")).toBe(false);
    expect(isSafeSvgAttribute("class", "b b-acc")).toBe(true);
    expect(isSafeSvgValue("JaVaScript:alert(1)")).toBe(false);
    expect(isSafeSvgValue("java script:alert(1)")).toBe(false);
    expect(isSafeSvgValue("url( #m )")).toBe(false);
    expect(isSafeSvgValue("translate(4 5)")).toBe(true);
  });

  it("lists every element and attribute once", () => {
    expect(new Set(svgElements).size).toBe(svgElements.length);
    expect(new Set(svgAttributes).size).toBe(svgAttributes.length);
    expect(new Set(svgAttributes.map((name) => name.toLowerCase())).size).toBe(
      svgAttributes.length,
    );
    expect(isSvgElement("tspan")).toBe(true);
    expect(isSvgElement("foreignObject")).toBe(false);
    expect(Object.isFrozen(svgElements)).toBe(true);
    expect(Object.isFrozen(svgAttributes)).toBe(true);
  });
});
