import type { Locator, Page } from "@playwright/test";
import { expect, layoutShift, test } from "./support/fixtures.ts";

/** Animations running inside the home board right now. */
function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        document.querySelector("[data-testid=demo-board]")?.getAnimations({
          subtree: true,
        }) ?? []
      ).filter((animation) => animation.playState === "running").length,
  );
}

const beatOf = async (demo: Locator) =>
  Number(await demo.getAttribute("data-beat"));

test.describe("home board", () => {
  test("plays a looping battle, holds still off screen and never moves the page", async ({
    page,
  }) => {
    await page.goto("/");
    const demo = page.getByRole("img", {
      name: "Example battle: a fleet under fire",
    });
    await expect(demo).toHaveAttribute("data-testid", "demo-board");
    // It opens on the full picture, then clears the water for a round.
    await expect(demo.locator(".mark")).toHaveCount(20);
    await expect(demo).toHaveAttribute("data-playing");
    await expect(demo).toHaveAttribute("data-phase", "reset");
    await expect(demo).toHaveAttribute("data-phase", "fire");
    await expect(demo.locator(".fx-tracer")).toHaveCount(1);
    await expect(demo).toHaveAttribute("data-phase", "land");
    await expect(demo.locator(".mark")).toHaveCount(1);
    await expect(demo.locator(".mark")).not.toHaveCount(1);
    expect(await runningAnimations(page)).toBeGreaterThan(0);
    expect(await layoutShift(page)).toBeLessThan(0.02);

    // Scrolled away it pauses: no beat passes, nothing animates.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect(demo).toHaveAttribute("data-paused");
    const beat = await beatOf(demo);
    await page.waitForTimeout(2500);
    expect(await beatOf(demo)).toBe(beat);
    expect(await runningAnimations(page)).toBe(0);

    // Back in view it goes on from there.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(demo).not.toHaveAttribute("data-paused");
    await expect.poll(() => beatOf(demo), { timeout: 5000 }).not.toBe(beat);
    expect(await layoutShift(page)).toBeLessThan(0.02);
  });

  test("the loop pauses in a hidden tab", async ({ page }) => {
    await page.goto("/");
    const demo = page.getByTestId("demo-board");
    await expect(demo).toHaveAttribute("data-playing");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(demo).toHaveAttribute("data-paused");
    const beat = await beatOf(demo);
    await page.waitForTimeout(2500);
    expect(await beatOf(demo)).toBe(beat);
  });

  test.describe("with reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the board is a still, complete and labelled picture", async ({
      page,
      context,
    }) => {
      await context.addCookies([
        { name: "og_locale", value: "ru", domain: "localhost", path: "/" },
      ]);
      await page.goto("/");
      const demo = page.getByRole("img", {
        name: "Пример боя: флот под обстрелом",
      });
      await expect(demo).toBeVisible();
      await page.waitForTimeout(3000);
      await expect(demo).toHaveAttribute("data-beat", "0");
      await expect(demo).toHaveAttribute("data-phase", "hold");
      await expect(demo).not.toHaveAttribute("data-playing");
      await expect(demo.locator(".mark")).toHaveCount(20);
      await expect(demo.locator(".demo-piece[data-shown]")).toHaveCount(10);
      await expect(demo.locator(".fx")).toHaveCount(0);
      expect(await runningAnimations(page)).toBe(0);
    });
  });
});
