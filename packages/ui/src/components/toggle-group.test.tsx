import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const items = (
  <>
    <ToggleGroupItem value="all">All</ToggleGroupItem>
    <ToggleGroupItem value="new">New</ToggleGroupItem>
    <ToggleGroupItem value="again" disabled>
      Again
    </ToggleGroupItem>
  </>
);

describe("ToggleGroup", () => {
  it("is a radio group when one choice is allowed", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup type="single" defaultValue="new" aria-label="Cards">
        {items}
      </ToggleGroup>,
    );
    expect(html).toMatch(/^<div [^>]*role="radiogroup" aria-label="Cards"/);
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>New</);
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>All</);
    expect(html).not.toContain("aria-pressed");
  });

  it("is a toolbar of pressed buttons when several are allowed", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup
        type="multiple"
        defaultValue={["all", "new"]}
        aria-label="Show"
      >
        {items}
      </ToggleGroup>,
    );
    expect(html).toMatch(/^<div [^>]*role="toolbar" aria-label="Show"/);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="false"[^>]*disabled=""[^>]*>Again</);
  });

  it("marks the pressed item for the token styles", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup type="single" value="all" aria-label="Cards">
        {items}
      </ToggleGroup>,
    );
    expect(html).toMatch(/data-state="on"[^>]*>All</);
    expect(html).toContain("data-[state=on]:bg-primary");
  });

  it("keeps a 44 px target for every size", () => {
    const render = (variant: "chip" | "segmented", size: "sm" | "md") =>
      renderToStaticMarkup(
        <ToggleGroup type="single" variant={variant} size={size} aria-label="x">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
        </ToggleGroup>,
      );
    // Drawn at 44 px: the item itself is the target.
    expect(render("chip", "md")).toMatch(/min-h-11[^"]*after:hidden/);
    // Drawn smaller: ::after reaches past it to 44 px (36 + 2 × (5 − 1 border),
    // 32 + 2 × 6, 40 + 2 × 2), and never narrower than 44 px.
    expect(render("chip", "sm")).toMatch(/min-h-9[^"]*after:-inset-y-\[5px\]/);
    expect(render("segmented", "sm")).toMatch(
      /min-h-8[^"]*after:-inset-y-1\.5/,
    );
    expect(render("segmented", "md")).toMatch(
      /min-h-10[^"]*after:-inset-y-0\.5/,
    );
    for (const html of [
      render("chip", "sm"),
      render("segmented", "sm"),
      render("segmented", "md"),
    ]) {
      expect(html).toMatch(/class="relative [^"]*min-w-11[^"]*after:absolute/);
    }
  });

  it("exposes variant and size to styles and tests", () => {
    const html = renderToStaticMarkup(
      <ToggleGroup
        type="single"
        variant="segmented"
        size="sm"
        aria-label="Speed"
      >
        <ToggleGroupItem value="1">1×</ToggleGroupItem>
      </ToggleGroup>,
    );
    expect(html).toContain('data-slot="toggle-group"');
    expect(html).toContain('data-variant="segmented"');
    expect(html).toContain('data-size="sm"');
    expect(html).toContain('data-slot="toggle-group-item"');
  });
});
