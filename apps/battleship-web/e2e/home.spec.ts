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

type Beat = {
  beat: number;
  phase: string | null;
  marks: number;
  tracers: number;
  ships: number;
};

/**
 * Logs every beat of the home board from the first paint on (a beat can
 * be shorter than an assertion's polling interval under load).
 */
async function recordBeats(page: Page) {
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as unknown as { __beats: unknown[] }).__beats = log;
    new MutationObserver((records) => {
      for (const record of records) {
        const el = record.target as Element;
        if (!el.matches?.("[data-testid=demo-board]")) continue;
        log.push({
          beat: Number(el.getAttribute("data-beat")),
          phase: el.getAttribute("data-phase"),
          marks: el.querySelectorAll(".mark").length,
          tracers: el.querySelectorAll(".fx-tracer").length,
          ships: el.querySelectorAll(".demo-piece[data-shown]").length,
        });
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-beat"],
    });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __beats: Beat[] }).__beats);
}

test.describe("home board", () => {
  test("plays a looping battle, holds still off screen and never moves the page", async ({
    page,
  }) => {
    const beats = await recordBeats(page);
    await page.goto("/");
    const demo = page.getByRole("img", {
      name: "Example battle: a fleet under fire",
    });
    await expect(demo).toHaveAttribute("data-testid", "demo-board");
    await expect(demo).toHaveAttribute("data-playing");
    await expect
      .poll(async () => (await beats()).some((b) => b.marks === 2), {
        timeout: 15_000,
      })
      .toBe(true);
    // From the full picture the water clears (the fleet dives), then the
    // sight aims, a shell flies, and each landing leaves its mark.
    const log = await beats();
    const at = (test: (beat: Beat) => boolean) => log.findIndex(test);
    const steps = [
      at((b) => b.phase === "reset" && b.marks === 20 && b.ships === 0),
      at((b) => b.phase === "aim" && b.marks === 0),
      at((b) => b.phase === "fire" && b.tracers === 1),
      at((b) => b.phase === "land" && b.marks === 1),
      at((b) => b.phase === "land" && b.marks === 2),
    ];
    expect(steps.every((index) => index >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
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
