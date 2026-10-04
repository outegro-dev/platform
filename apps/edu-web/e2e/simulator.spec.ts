import { book } from "./support/books.ts";
import { expect, signIn, test } from "./support/fixtures.ts";

const scenarios = book("nodejs-internals").eventLoop?.scenarios ?? [];

test.describe("event loop simulator", () => {
  test("steps forward and back through a scenario", async ({ page }) => {
    const first = scenarios[0];
    if (!first) throw new Error("no scenarios");
    await signIn(page, "subscriber", "/books/nodejs-internals/4");
    const sim = page.locator(".simulator");
    await expect(sim).toContainText("Симулятор event loop");
    const step = sim.locator(".sim-step");
    const current = sim.locator(".sim-code li[aria-current='step']");
    const total = first.steps.length;

    await expect(step).toHaveText(`Шаг 1 из ${total}`);
    await expect(current).toContainText(first.code[0] ?? "");
    await expect(sim.locator(".sim-console")).toContainText("A");
    await expect(sim.locator(".sim-phases li[data-on]")).toHaveText("скрипт");

    const next = sim.getByRole("button", { name: "Дальше" });
    const back = sim.getByRole("button", { name: "Назад" });
    await expect(back).toHaveAttribute("aria-disabled", "true");
    await next.click();
    await expect(step).toHaveText(`Шаг 2 из ${total}`);
    await expect(current).toContainText(first.code[1] ?? "");
    await expect(sim.locator(".sim-queue[data-kind='timers'] li")).toHaveCount(
      1,
    );

    for (let i = 0; i < 4; i++) await next.click();
    await expect(step).toHaveText(`Шаг 6 из ${total}`);
    await expect(sim.locator(".sim-phases li[data-on]")).toHaveText("nextTick");
    // The line printed by this step stands out.
    await expect(sim.locator(".sim-console [data-new]")).toHaveText("D");
    await expect(sim.locator(".sim-note")).toContainText("nextTick");

    await back.click();
    await expect(step).toHaveText(`Шаг 5 из ${total}`);
    await sim.getByRole("button", { name: "Сначала" }).click();
    await expect(step).toHaveText(`Шаг 1 из ${total}`);

    // Through to the end: Next stops, keeping focus.
    for (let i = 1; i < total; i++) await next.click();
    await expect(step).toHaveText(`Шаг ${total} из ${total}`);
    await expect(next).toHaveAttribute("aria-disabled", "true");
    await expect(next).toBeFocused();
    await expect(sim.locator(".sim-phases li[data-on]")).toHaveText("выход");
  });

  test("another scenario starts from its first step", async ({ page }) => {
    const second = scenarios[1];
    if (!second) throw new Error("no second scenario");
    await signIn(page, "subscriber", "/books/nodejs-internals/4");
    const sim = page.locator(".simulator");
    await sim.getByRole("button", { name: "Дальше" }).click();
    const chip = sim.getByRole("radio", { name: second.name });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-checked", "true");
    await expect(sim.locator(".sim-step")).toHaveText(
      `Шаг 1 из ${second.steps.length}`,
    );
    await expect(sim.locator(".sim-code li")).toHaveCount(second.code.length);
    await expect(sim.locator(".sim-queue[data-kind='io'] li")).toHaveCount(1);
  });
});
