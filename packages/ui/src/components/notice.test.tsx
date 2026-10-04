import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Notice, StatePanel } from "./notice";

const roleOf = (html: string) =>
  html.match(/^<[a-z]+ [^>]*?role="([^"]+)"/)?.[1];

describe("Notice", () => {
  it("is not a live region unless asked", () => {
    expect(roleOf(renderToStaticMarkup(<Notice>Saved drafts</Notice>))).toBe(
      undefined,
    );
  });

  it("maps live to status (polite) and alert (assertive)", () => {
    expect(
      roleOf(renderToStaticMarkup(<Notice live="polite">Saved</Notice>)),
    ).toBe("status");
    expect(
      roleOf(
        renderToStaticMarkup(
          <Notice live="assertive" tone="danger">
            Payment failed
          </Notice>,
        ),
      ),
    ).toBe("alert");
  });

  it("lets an explicit role win", () => {
    expect(
      roleOf(
        renderToStaticMarkup(
          <Notice live="polite" role="note">
            Tip
          </Notice>,
        ),
      ),
    ).toBe("note");
  });

  it("draws a decorative icon per tone, replaceable or removable", () => {
    for (const tone of [
      "neutral",
      "info",
      "success",
      "warning",
      "danger",
    ] as const) {
      const html = renderToStaticMarkup(<Notice tone={tone}>Text</Notice>);
      expect(html).toContain(`data-tone="${tone}"`);
      expect(html).toMatch(
        /<span aria-hidden="true" data-slot="notice-icon"[^>]*><svg/,
      );
    }
    expect(
      renderToStaticMarkup(<Notice icon={<i data-glyph="" />}>Text</Notice>),
    ).toContain('data-glyph=""');
    expect(
      renderToStaticMarkup(<Notice icon={null}>Text</Notice>),
    ).not.toContain("notice-icon");
  });

  it("uses the tone's soft surface and ink tokens", () => {
    const html = renderToStaticMarkup(<Notice tone="warning">Text</Notice>);
    expect(html).toContain("bg-warn-soft");
    expect(html).toContain("text-warn");
  });

  it("renders the title, the body and the actions slot", () => {
    const html = renderToStaticMarkup(
      <Notice
        tone="info"
        title="Offline"
        actions={<button type="button">Retry</button>}
      >
        Changes are kept on this device.
      </Notice>,
    );
    expect(html).toContain('data-slot="notice-title"');
    expect(html).toContain(">Offline</p>");
    expect(html).toMatch(
      /data-slot="notice-body" class="text-muted-foreground">Changes are kept/,
    );
    expect(html).toContain(
      '<div data-slot="notice-actions" class="mt-2 flex flex-wrap items-center gap-2"><button type="button">Retry</button></div>',
    );
  });
});

describe("StatePanel", () => {
  it("is a section with an h2 title by default", () => {
    const html = renderToStaticMarkup(
      <StatePanel
        title="Nothing here yet"
        description="Saved cards appear here."
      />,
    );
    expect(html).toMatch(/^<section data-slot="state-panel"/);
    expect(html).toMatch(
      /<h2 data-slot="state-panel-title"[^>]*>Nothing here yet<\/h2>/,
    );
    expect(html).toContain('data-slot="state-panel-description"');
    expect(roleOf(html)).toBe(undefined);
  });

  it("takes the heading level and the element from the page outline", () => {
    const html = renderToStaticMarkup(
      <StatePanel as="main" headingLevel={1} title="Something went wrong" />,
    );
    expect(html).toMatch(/^<main /);
    expect(html).toContain("<h1 ");
    expect(
      renderToStaticMarkup(<StatePanel headingLevel={3} title="Empty" />),
    ).toContain("<h3 ");
  });

  it("announces only when asked", () => {
    expect(
      roleOf(
        renderToStaticMarkup(
          <StatePanel live="assertive" tone="danger" title="Unavailable" />,
        ),
      ),
    ).toBe("alert");
    expect(
      roleOf(
        renderToStaticMarkup(<StatePanel live="polite" title="Offline" />),
      ),
    ).toBe("status");
  });

  it("keeps a decorative icon badge and the actions", () => {
    const html = renderToStaticMarkup(
      <StatePanel
        tone="danger"
        title="Unavailable"
        actions={<a href="/retry">Retry</a>}
      />,
    );
    expect(html).toMatch(
      /<span aria-hidden="true" data-slot="state-panel-icon"[^>]*bg-danger-soft/,
    );
    expect(html).toContain('<a href="/retry">Retry</a>');
    expect(
      renderToStaticMarkup(<StatePanel icon={null} title="Empty" />),
    ).not.toContain("state-panel-icon");
  });

  it("reserves its height so a swap does not move the page", () => {
    expect(renderToStaticMarkup(<StatePanel title="Empty" />)).toContain(
      "min-h-72",
    );
    expect(
      renderToStaticMarkup(<StatePanel size="sm" title="Empty" />),
    ).toContain("min-h-48");
  });
});
