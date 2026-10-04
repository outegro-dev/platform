import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "./button";

describe("Button touch target", () => {
  it("extends sizes drawn under 44 px with an invisible ::after", () => {
    // 40 px tall: 3 px above and below (measured inside a 1 px border).
    expect(buttonVariants({ size: "sm" })).toMatch(
      /\brelative\b.*after:absolute after:inset-x-0 after:-inset-y-\[3px\]/,
    );
    // 36 px square: 5 px on every side.
    expect(buttonVariants({ size: "icon-sm" })).toMatch(
      /\brelative\b.*after:absolute after:-inset-\[5px\]/,
    );
  });

  it("leaves sizes of 44 px and more as they are", () => {
    for (const size of ["md", "lg", "icon"] as const)
      expect(buttonVariants({ size })).not.toContain("after:");
  });

  it("does not extend a link in running text", () => {
    expect(buttonVariants({ variant: "link", size: "sm" })).toContain(
      "after:hidden",
    );
  });

  it("keeps the extension while pending, under the spinner", () => {
    const html = renderToStaticMarkup(
      <Button size="sm" pending pendingLabel="Saving…">
        Save
      </Button>,
    );
    expect(html).toContain("after:-inset-y-[3px]");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('<span class="sr-only">Saving…</span>');
  });

  it("lets a positioned className replace relative", () => {
    const html = renderToStaticMarkup(
      <Button size="sm" className="absolute top-3 right-3">
        Close
      </Button>,
    );
    expect(html).toMatch(/class="[^"]*\babsolute\b/);
    expect(html).not.toMatch(/class="[^"]*\brelative\b/);
  });
});
