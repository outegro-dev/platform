import {
  expect,
  expectAccessible,
  openFirstRow,
  signIn,
  test,
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
