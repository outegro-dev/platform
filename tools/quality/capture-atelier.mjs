// Captures the Atelier screens shown in the landing's Projects section.
// atelier.outegro.dev is sign-in only and holds a real job search, so it is
// never captured. Instead the production build of apps/atelier-web runs in
// its mock mode (ATELIER_API_URL=mock), exactly as its own Playwright tests
// run it: sign-in is skipped and the made-up data of src/lib/mock-data.ts
// (a fictional engineer and fictional companies) stands in for
// atelier-backend. Writes 2x WebP files, English and Russian, to
// apps/landing-web/src/assets/atelier.
//
//   pnpm --filter "@outegro/atelier-web^..." build
//   pnpm --filter @outegro/atelier-web build
//   node tools/quality/capture-atelier.mjs [--png <dir>]
//
// --png also keeps the full-size PNG captures for review.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps/atelier-web");
const out = path.join(root, "apps/landing-web/src/assets/atelier");
const pngFlag = process.argv.indexOf("--png");
const pngDir = pngFlag > 0 ? path.resolve(process.argv[pngFlag + 1]) : null;

// Own port, so a parallel run of the app's e2e suite (3197) is untouched.
const APP_PORT = 3298;
const APP = `http://localhost:${APP_PORT}`;
const desktop = { width: 1440, height: 900 };

let server;
function stop() {
  if (!server || server.exitCode !== null) return;
  // start-standalone.mjs spawns server.js: stop the whole tree.
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  else process.kill(-server.pid, "SIGTERM");
}
async function waitFor(url, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`${url} did not come up`);
}

/** Encodes one capture: 2x pixels, WebP tuned for flat UI and small text. */
async function save(png, name) {
  if (pngDir) await writeFile(path.join(pngDir, `${name}.png`), png);
  const info = await sharp(png)
    .webp({ quality: 80, effort: 6, smartSubsample: true })
    .toFile(path.join(out, `${name}.webp`));
  console.log(
    `${name}.webp ${info.width}x${info.height} ${(info.size / 1024).toFixed(1)} KB`,
  );
}

/** Starts the made-up data over, so every capture sees the same board. */
async function resetMock() {
  const response = await fetch(`${APP}/api/atelier/mock/reset`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  });
  if (response.status !== 204)
    throw new Error(`mock reset answered ${response.status}`);
}

/** Fonts in, animations done: what a screenshot should see. */
async function settle(page) {
  // The PDF viewer in the Resume tab can keep a request open: not fatal.
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
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

/*
 * The landing prints these shots through its own filter and dot screen, so
 * any page texture would moiré under it and weigh the files down. The
 * captures keep the paper colour and the drawer's tint, not their dots.
 */
const PLAIN_PAPER = `body, .drawer-overlay { background-image: none !important; }`;

async function capture(page, name) {
  await page.addStyleTag({ content: PLAIN_PAPER });
  await settle(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(600);
  await save(await page.screenshot({ animations: "disabled" }), name);
}

/** The made-up person and companies only: fail on anything else. */
async function expectDemoData(page, where) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const word of [/lukash/i, /лукаш/i, /nikita/i, /никит/i, /gmail/i])
    if (word.test(text)) throw new Error(`${where}: personal data (${word})`);
}

await mkdir(out, { recursive: true });
if (pngDir) await mkdir(pngDir, { recursive: true });

let browser;
try {
  server = spawn(
    process.execPath,
    ["../../tools/dev/start-standalone.mjs", String(APP_PORT)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        HOSTNAME: "0.0.0.0",
        APP_URL: APP,
        ATELIER_API_URL: "mock",
      },
      stdio: ["ignore", "ignore", "inherit"],
      detached: process.platform !== "win32",
    },
  );
  await waitFor(`${APP}/health`);
  // The full Chromium in its new headless mode has the PDF viewer, so the
  // Resume tab shows the CV itself rather than the "open the PDF" sheet.
  browser = await chromium.launch({ channel: "chromium" });

  for (const locale of ["en", "ru"]) {
    await resetMock();
    const context = await browser.newContext({
      viewport: desktop,
      deviceScaleFactor: 2,
      locale: locale === "ru" ? "ru-RU" : "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });
    await context.addCookies([
      { name: "og_locale", value: locale, domain: "localhost", path: "/" },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error("pageerror:", error.message));

    // The board: every stage of the search at a glance.
    await page.goto(`${APP}/`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await expectDemoData(page, `board ${locale}`);
    await capture(page, `board-${locale}`);

    // One application opened over the board, on its tailored CV.
    await page.getByRole("link", { name: "Brightline Health", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Brightline Health" });
    await panel.waitFor();
    await page.waitForURL(/\/applications\//);
    const frame = panel.locator("iframe.cv-frame");
    if (await frame.count()) {
      await frame.waitFor();
      await page.waitForTimeout(2500);
    }
    await expectDemoData(page, `cv ${locale}`);
    await capture(page, `cv-${locale}`);
    await context.close();
  }
} finally {
  await browser?.close();
  stop();
}
