import type { Locator } from "@playwright/test";
import {
  expect,
  expectAccessible,
  openFirstRow,
  phone,
  signIn,
  test,
  visit,
} from "./fixtures";

/**
 * The accessibility check measures final colours: a dialog still fading in
 * reads as low contrast (the flaky user-suspend-dialog screen). Slowed down
 * tenfold, the dialog is still opening when the check starts, every time.
 */
test("the accessibility check waits for a dialog to finish opening", async ({
  page,
}) => {
  await signIn(page, "owner", "/users?query=chloe");
  await openFirstRow(page);
  const devtools = await page.context().newCDPSession(page);
  await devtools.send("Animation.enable");
  await devtools.send("Animation.setPlaybackRate", { playbackRate: 0.1 });

  await page.getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const opening = await dialog.evaluate((node) =>
    node
      .getAnimations({ subtree: true })
      .some((animation) => animation.playState === "running"),
  );
  expect(opening, "the dialog is still fading in").toBe(true);
  await expectAccessible(page);
});

/**
 * Whether a tap at the edges of a 44 × 44 px square around the link's centre
 * (just inside them) lands on the link: up, down, left and right.
 */
async function takesA44pxTap(link: Locator) {
  await link.evaluate((node) => node.scrollIntoView({ block: "center" }));
  return link.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    return [
      [0, -21.5],
      [0, 21.5],
      [-21.5, 0],
      [21.5, 0],
    ].map(([dx = 0, dy = 0]) => {
      const hit = document.elementFromPoint(x + dx, y + dy);
      return hit !== null && node.contains(hit);
    });
  });
}

for (const [device, options] of [
  ["desktop", {}],
  ["phone", phone],
] as const) {
  test.describe(`links in a card's head (${device})`, () => {
    test.use(options);

    test("keep their 32 px pill and take a tap anywhere in 44 × 44 px", async ({
      page,
    }) => {
      await signIn(page, "owner", "/education/books/sql-internals");
      const links = [
        // The way back to the list (`BackLink`) and a "see all" link.
        page.locator("#book").getByRole("link", { name: "Books" }),
        page.getByRole("link", { name: "All readers" }),
      ];
      for (const link of links) {
        const box = await link.boundingBox();
        expect(box?.height).toBeCloseTo(32, 0);
        expect(await takesA44pxTap(link)).toEqual([true, true, true, true]);
      }

      // An arrow-only link (34 px wide) at the end of a scrolling list…
      await visit(page, "/");
      const arrow = page.locator("#attention .panel-link").first();
      const box = await arrow.boundingBox();
      expect(box?.width).toBeLessThan(44);
      expect(await takesA44pxTap(arrow)).toEqual([true, true, true, true]);
      // …which does not make the list scroll sideways.
      expect(
        await page
          .locator("#attention .attention")
          .evaluate((list) => list.scrollWidth - list.clientWidth),
      ).toBe(0);
    });
  });
}
