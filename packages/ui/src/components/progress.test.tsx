import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Progress, progressRange } from "./progress";

const attr = (html: string, name: string) =>
  html.match(new RegExp(`${name}="([^"]*)"`))?.[1];

describe("progressRange", () => {
  it("keeps values inside [0, max]", () => {
    expect(progressRange(3, 10)).toEqual({ value: 3, max: 10, offset: 70 });
    expect(progressRange(15, 10)).toEqual({ value: 10, max: 10, offset: 0 });
    expect(progressRange(-4, 10)).toEqual({ value: 0, max: 10, offset: 100 });
    expect(progressRange(Number.POSITIVE_INFINITY, 10).value).toBe(10);
    expect(progressRange(Number.NaN, 10).value).toBe(0);
  });

  it("defaults to a total of 100", () => {
    expect(progressRange(40)).toEqual({ value: 40, max: 100, offset: 60 });
  });

  it("reads an impossible total as nothing done", () => {
    for (const max of [0, -3, Number.NaN, Number.POSITIVE_INFINITY])
      expect(progressRange(5, max)).toEqual({
        value: 0,
        max: 100,
        offset: 100,
      });
  });

  it("rounds the offset to hundredths of a percent", () => {
    expect(progressRange(1, 3).offset).toBe(66.67);
    expect(progressRange(0.4, 1).offset).toBe(60);
  });
});

describe("Progress", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a named progressbar with the clamped value", () => {
    const html = renderToStaticMarkup(
      <Progress label="Exercises solved" value={3} max={10} />,
    );
    expect(html).toContain('role="progressbar"');
    expect(attr(html, "aria-label")).toBe("Exercises solved");
    expect(attr(html, "aria-valuemin")).toBe("0");
    expect(attr(html, "aria-valuemax")).toBe("10");
    expect(attr(html, "aria-valuenow")).toBe("3");
    expect(attr(html, "aria-valuetext")).toBe("30%");
    expect(attr(html, "data-state")).toBe("loading");
  });

  it("speaks the caller's value text", () => {
    const html = renderToStaticMarkup(
      <Progress
        aria-labelledby="cards-label"
        value={7}
        max={12}
        valueText="7 of 12 cards known"
      />,
    );
    expect(attr(html, "aria-labelledby")).toBe("cards-label");
    expect(html).not.toContain("aria-label=");
    expect(attr(html, "aria-valuetext")).toBe("7 of 12 cards known");
  });

  it("clamps out-of-range values instead of letting Radix drop them", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const over = renderToStaticMarkup(
      <Progress label="Upload" value={140} max={100} />,
    );
    expect(attr(over, "aria-valuenow")).toBe("100");
    expect(attr(over, "data-state")).toBe("complete");
    expect(over).toContain("transform:translateX(0%)");
    const under = renderToStaticMarkup(<Progress label="Upload" value={-2} />);
    expect(attr(under, "aria-valuenow")).toBe("0");
    expect(under).toContain("transform:translateX(-100%)");
    const empty = renderToStaticMarkup(
      <Progress label="Exercises" value={0} max={0} />,
    );
    expect(attr(empty, "aria-valuenow")).toBe("0");
    expect(error).not.toHaveBeenCalled();
  });

  it("moves the fill with a transform, never its width", () => {
    const html = renderToStaticMarkup(<Progress label="Read" value={25} />);
    expect(html).toContain('style="transform:translateX(-75%)"');
    expect(html).not.toMatch(/width:\s*\d/);
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("has tones and sizes from tokens", () => {
    const ok = renderToStaticMarkup(
      <Progress label="Known" value={1} tone="ok" size="lg" />,
    );
    expect(attr(ok, "data-tone")).toBe("ok");
    expect(ok).toContain("bg-ok");
    expect(ok).toContain("h-3");
    const accent = renderToStaticMarkup(<Progress label="Read" value={1} />);
    expect(accent).toContain("bg-[var(--progress-fill,var(--primary))]");
    expect(accent).toContain("h-2");
  });

  it("lets the caller tint the accent fill with another token", () => {
    const html = renderToStaticMarkup(
      <Progress
        label="Read"
        value={1}
        className="[--progress-fill:var(--book-accent)]"
      />,
    );
    expect(html).toMatch(
      /role="progressbar"[^>]*class="[^"]*\[--progress-fill:var\(--book-accent\)\]/,
    );
  });
});
