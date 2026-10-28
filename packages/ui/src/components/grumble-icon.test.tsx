import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GrumbleIcon } from "./grumble-icon";

describe("GrumbleIcon", () => {
  it("is decorative next to a number", () => {
    const html = renderToStaticMarkup(<GrumbleIcon />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
    expect(html).not.toContain("<title>");
  });

  it("names itself when it stands alone", () => {
    const html = renderToStaticMarkup(<GrumbleIcon title="grumbles" />);
    expect(html).toContain('role="img"');
    expect(html).toContain("<title>grumbles</title>");
    expect(html).not.toContain("aria-hidden");
  });

  it("takes its colours from the theme, with fallbacks outside it", () => {
    const html = renderToStaticMarkup(<GrumbleIcon className="size-6" />);
    expect(html).toContain("var(--spot-yellow, #f5c518)");
    expect(html).toContain("var(--coin-shadow, currentColor)");
    expect(html).toContain("var(--ink, #1b1915)");
    expect(html).toMatch(/class="[^"]*size-6/);
  });
});
