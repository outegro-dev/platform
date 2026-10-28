import { mkdirSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

export const viewports = {
  mobile: { width: 375, height: 812 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1440, height: 900 },
} as const;
export type ViewportName = keyof typeof viewports;

const shots = path.resolve(
  process.env.E2E_SCREENSHOTS_DIR ?? "test-results/screenshots",
);

/** Every test: console errors and uncaught exceptions fail it. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (failure) => errors.push(failure.message));
      await use(errors);
      expect(errors, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Starts the made-up data over, so every test sees the same board. */
export async function resetMock(page: Page) {
  const response = await page.request.post("/api/atelier/mock/reset", {
    headers: { "sec-fetch-site": "same-origin" },
  });
  expect(response.status()).toBe(204);
}

/** Fonts in, animations done: what a screenshot or axe should see. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== "running" ||
          a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );
}

/** No accessibility violations (WCAG 2.2 AA rules), whatever their impact. */
export async function expectAccessible(page: Page, where: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations.map(
      (v) =>
        `${where}: ${v.id} × ${v.nodes.length} (${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join(", ")})`,
    ),
  ).toEqual([]);
}

/** The page itself never scrolls sideways (the board may, inside itself). */
export async function expectNoSideScroll(page: Page, where: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${where}: horizontal page scroll`).toBeLessThanOrEqual(0);
}

/**
 * Touch targets on a phone: every visible button, link and field is at
 * least 44 px in both directions, counting the kit's invisible ::after
 * extension of compact controls. Links inside running text are exempt.
 */
export async function expectTouchTargets(page: Page, where: string) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const nodes = document.querySelectorAll<HTMLElement>(
      "a[href], button, select, input, textarea, [role=tab]",
    );
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden") continue;
      if (node.closest("p, li.req, dd") && node.tagName === "A") {
        const inline = getComputedStyle(node).display.startsWith("inline");
        if (inline) continue;
      }
      const after = getComputedStyle(node, "::after");
      let width = box.width;
      let height = box.height;
      // A stretched link: its ::after covers the positioned ancestor (a card).
      if (
        after.content !== "none" &&
        after.position === "absolute" &&
        style.position === "static" &&
        node.offsetParent instanceof HTMLElement
      ) {
        const cover = node.offsetParent.getBoundingClientRect();
        width = Math.max(width, cover.width);
        height = Math.max(height, cover.height);
      } else if (after.content !== "none" && after.position === "absolute") {
        const top = Number.parseFloat(after.top) || 0;
        const bottom = Number.parseFloat(after.bottom) || 0;
        const left = Number.parseFloat(after.left) || 0;
        const right = Number.parseFloat(after.right) || 0;
        height = Math.max(height, box.height - top - bottom);
        width = Math.max(width, box.width - left - right);
      }
      if (width < 43.5 || height < 43.5)
        out.push(
          `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""} "${(node.textContent ?? node.getAttribute("aria-label") ?? "").trim().slice(0, 30)}" ${Math.round(width)}×${Math.round(height)}`,
        );
    }
    return out;
  });
  expect(small, `${where}: touch targets under 44 px`).toEqual([]);
}

export async function screenshot(page: Page, name: string, fullPage = true) {
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });
}
