// Captures the Battleship screens shown in the landing's Projects section.
// The production build of apps/battleship-web runs against its end-to-end
// fake platform (sign-in, game HTTP, payments) with the game socket scripted
// in the browser, exactly as the game's own Playwright tests run it, so the
// screens show test data. Writes 2x WebP files, English and Russian, to
// apps/landing-web/src/assets/battleship.
//
//   pnpm --filter @outegro/battleship-web build
//   node tools/quality/capture-battleship.mjs [--png <dir>]
//
// --png also keeps the full-size PNG captures for review.
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../..");
const gameDir = path.join(root, "apps/battleship-web");
const out = path.join(root, "apps/landing-web/src/assets/battleship");
const pngFlag = process.argv.indexOf("--png");
const pngDir = pngFlag > 0 ? path.resolve(process.argv[pngFlag + 1]) : null;

// Own ports, so a parallel run of the game's e2e suite (3195/4195) is untouched.
const APP_PORT = 3295;
const PLATFORM_PORT = 4295;
const APP = `http://localhost:${APP_PORT}`;
const PLATFORM = `http://localhost:${PLATFORM_PORT}`;
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

const children = [];
function start(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: gameDir,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "inherit"],
    detached: process.platform !== "win32",
  });
  children.push(child);
}
function stopAll() {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    // start-standalone.mjs spawns server.js: stop the whole tree.
    if (process.platform === "win32")
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, "SIGTERM");
  }
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

/** Signs in through the fake identity page and waits for the game socket. */
async function signIn(browser, { locale, viewport }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: locale === "ru" ? "ru-RU" : "en-US",
    colorScheme: "light",
  });
  await context.addCookies([
    { name: "og_locale", value: locale, domain: "localhost", path: "/" },
    { name: "e2e_persona", value: "premium", domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  const harness = new GameHarness();
  await page.routeWebSocket(/\/ws\?ticket=/, (ws) => harness.connect(ws));
  await page.goto(`${APP}/auth/sign-in?returnTo=%2F`);
  await page.waitForURL((url) => url.pathname === "/");
  const game = await harness.current();
  await page.waitForFunction(() =>
    /Connected|Подключено/.test(
      document
        .querySelector('[data-testid="player-chip"]')
        ?.getAttribute("title") ?? "",
    ),
  );
  const close = async () => {
    harness.dispose();
    await context.close();
  };
  return { page, game, close };
}

async function capture(page, name, { keepPointer = false } = {}) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  if (!keepPointer) await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  await save(await page.screenshot({ animations: "disabled" }), name);
}

const cell = (page, board, x, y) =>
  page.getByTestId(board).locator(`button[data-x="${x}"][data-y="${y}"]`);

const cellsOf = (ship) =>
  Array.from({ length: ship.length }, (_, i) =>
    ship.orientation === "horizontal"
      ? { x: ship.x + i, y: ship.y }
      : { x: ship.x, y: ship.y + i },
  );

/** Fires at a cell of enemy waters and waits for the shot to land. */
async function fireAt(page, { x, y }) {
  const target = cell(page, "target-board", x, y);
  await target.and(page.locator(':not([aria-disabled="true"])')).waitFor();
  await target.click();
  await page.waitForFunction(
    ([cx, cy]) => {
      const label =
        document
          .querySelector(
            `[data-testid="target-board"] button[data-x="${cx}"][data-y="${cy}"]`,
          )
          ?.getAttribute("aria-label") ?? "";
      return (
        !/, (unknown|неизвестно)$/.test(label) ||
        document.querySelector('[data-testid="result"]')
      );
    },
    [x, y],
  );
}

async function yourTurn(page) {
  await page
    .getByTestId("turn-indicator")
    .and(page.locator('[data-turn="you"]'))
    .waitFor({ timeout: 15_000 });
}

async function startBot(page, level) {
  await page
    .locator("label.level", { has: page.locator(`input[value="${level}"]`) })
    .click();
  await page.getByTestId("start-bot").click();
  await page.getByTestId("placement").waitFor();
}

/** A few ships on the board, the next one hovering where it would land. */
async function placeSome(page) {
  for (const [x, y] of [
    [1, 1],
    [6, 1],
    [1, 3],
    [5, 3],
  ])
    await cell(page, "placement-board", x, y).click();
  // A click focuses the cell, and a focused board previews at the keyboard
  // cursor; drop the focus so the preview follows the mouse only.
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  await cell(page, "placement-board", 7, 6).hover();
  await page.waitForTimeout(300);
}

/** Deploys a random fleet and plays a short exchange: misses, hits, sinkings. */
async function battle(page, game) {
  await page.getByTestId("random-fleet").click();
  await page.getByTestId("ready").click();
  await page.getByTestId("battle").waitFor();
  await yourTurn(page);

  // The bot: a miss, two hits on your biggest ship, then misses.
  const own = game.match.viewFor("you").own.ships;
  const taken = new Set(own.flatMap(cellsOf).map(({ x, y }) => `${x},${y}`));
  const water = (x, y) => (taken.has(`${x},${y}`) ? null : { x, y });
  const biggest = own.reduce((a, b) => (b.length > a.length ? b : a));
  game.script.botShots = [
    water(8, 0),
    ...cellsOf(biggest).slice(0, 2),
    water(2, 7),
    water(6, 4),
    water(0, 3),
  ].filter(Boolean);

  // You: sink a submarine and a destroyer, hit the battleship, miss a few
  // times in open water away from every ship.
  const enemy = game.opponentFleet;
  const near = new Set(
    enemy
      .flatMap(cellsOf)
      .flatMap(({ x, y }) =>
        [-1, 0, 1].flatMap((dx) =>
          [-1, 0, 1].map((dy) => `${x + dx},${y + dy}`),
        ),
      ),
  );
  const single = enemy.find((ship) => ship.length === 1);
  const pair = enemy.find((ship) => ship.length === 2);
  const big = enemy.find((ship) => ship.length === 4);
  for (const target of [...cellsOf(single), ...cellsOf(pair), cellsOf(big)[0]])
    await fireAt(page, target);
  const misses = [
    [7, 7],
    [2, 8],
    [4, 5],
    [8, 3],
    [1, 5],
    [6, 9],
    [9, 6],
    [3, 2],
  ]
    .filter(([x, y]) => !near.has(`${x},${y}`))
    .slice(0, 4);
  for (const [x, y] of misses) {
    await fireAt(page, { x, y });
    await yourTurn(page);
  }
}

await mkdir(out, { recursive: true });
if (pngDir) await mkdir(pngDir, { recursive: true });
const { GameHarness } = await import(
  pathToFileURL(path.join(gameDir, "e2e/support/fake-game.ts")).href
);

let browser;
try {
  start(
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "e2e/fake-platform.ts"],
    { FAKE_PLATFORM_PORT: String(PLATFORM_PORT), FAKE_APP_ORIGIN: APP },
  );
  start(["../../tools/dev/start-standalone.mjs", String(APP_PORT)], {
    HOSTNAME: "0.0.0.0",
    APP_URL: APP,
    BATTLESHIP_API_URL: PLATFORM,
    AUTH_API_URL: PLATFORM,
    ID_URL: PLATFORM,
    SITE_URL: `${PLATFORM}/site`,
    GAME_WS_URL: `ws://localhost:${PLATFORM_PORT}`,
    PAYMENTS_API_URL: PLATFORM,
    CHECKOUT_ORIGINS: "https://checkout.fake.test",
    CLIENT_IP_SOURCE: "x-forwarded-for",
  });
  await waitFor(`${PLATFORM}/health`);
  await waitFor(`${APP}/health`);
  browser = await chromium.launch();

  for (const locale of ["en", "ru"]) {
    // A match against the Expert bot: placement, then the battle.
    const match = await signIn(browser, { locale, viewport: desktop });
    await startBot(match.page, "expert");
    await placeSome(match.page);
    await capture(match.page, `placement-${locale}`, { keepPointer: true });
    await battle(match.page, match.game);
    await capture(match.page, `battle-${locale}`);
    await match.close();

    // A fresh session, so no "match in progress" strip covers the pages.
    const stats = await signIn(browser, { locale, viewport: desktop });
    await stats.page.goto(`${APP}/leaderboard`);
    await stats.page.getByTestId("leaderboard-table").waitFor();
    await capture(stats.page, `leaderboard-${locale}`);
    await stats.page.goto(`${APP}/profile`);
    await stats.page.getByTestId("stat-cards").waitFor();
    await capture(stats.page, `profile-${locale}`);
    await stats.close();

    const lobby = await signIn(browser, { locale, viewport: phone });
    await capture(lobby.page, `lobby-phone-${locale}`);
    await lobby.close();
  }
} finally {
  await browser?.close();
  stopAll();
}
