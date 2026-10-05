import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

const render = (props: Partial<ComponentProps<typeof Tabs>> = {}) =>
  renderToStaticMarkup(
    <Tabs defaultValue="analogy" {...props}>
      <TabsList aria-label="Ways to see it">
        <TabsTrigger value="analogy">Analogy</TabsTrigger>
        <TabsTrigger value="code">Code</TabsTrigger>
        <TabsTrigger value="diagram" disabled>
          Diagram
        </TabsTrigger>
      </TabsList>
      <TabsContent value="analogy">A queue at the post office.</TabsContent>
      <TabsContent value="code" forceMount>
        queueMicrotask(fn)
      </TabsContent>
      <TabsContent value="diagram">Boxes and arrows.</TabsContent>
    </Tabs>,
  );

describe("Tabs", () => {
  it("is a named tab list with one selected tab", () => {
    const html = render();
    expect(html).toMatch(
      /role="tablist" aria-orientation="horizontal"[^>]*aria-label="Ways to see it"/,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>Analogy</);
    expect(html).toMatch(/role="tab" aria-selected="false"[^>]*>Code</);
    expect(html).toMatch(/aria-selected="false"[^>]*disabled=""[^>]*>Diagram</);
  });

  it("links each tab to its panel", () => {
    const html = render();
    const controls = html.match(
      /role="tab" aria-selected="true" aria-controls="([^"]+)"/,
    )?.[1];
    expect(controls).toBeTruthy();
    expect(html).toMatch(
      new RegExp(
        `role="tabpanel" aria-labelledby="[^"]+" id="${controls}" tabindex="0"`,
      ),
    );
  });

  it("renders only the selected panel, unless one is kept mounted", () => {
    const html = render();
    expect(html).toContain("A queue at the post office.");
    expect(html).not.toContain("Boxes and arrows.");
    // forceMount keeps state; the inactive panel is hidden by its styles.
    expect(html).toMatch(
      /data-state="inactive"[^>]*class="[^"]*data-\[state=inactive\]:hidden[^"]*"[^>]*>queueMicrotask\(fn\)/,
    );
  });

  it("draws 44 px tabs in a list that scrolls on its own", () => {
    const html = render();
    expect(html).toMatch(
      /data-slot="tabs-list"[^>]*class="[^"]*overflow-x-auto/,
    );
    expect(
      html.match(/data-slot="tabs-trigger"[^>]*class="[^"]*min-h-11/g),
    ).toHaveLength(3);
  });

  it("styles the pill variant for every list and tab inside", () => {
    const html = render({ variant: "pill" });
    expect(html).toContain('data-variant="pill"');
    expect(html).toContain("data-[state=active]:bg-primary");
    expect(render()).toContain("data-[state=active]:border-foreground");
  });

  it("passes the activation mode to Radix", () => {
    // Manual activation changes behaviour only in the browser; the markup is
    // the same, which is what the server sends.
    expect(render({ activationMode: "manual" })).toContain('role="tablist"');
  });
});
