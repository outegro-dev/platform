// Captures the Roulette screens shown in the landing's Projects section.
// A signed-out visitor of roulette.outegro.dev sees only the strip and the
// last results, and capturing a signed-in table would mean a real account
// and real players' nicknames. So the production build of apps/roulette-web
// runs here against a small fake platform (identity, roulette-backend,
// wallet, daily bonus) with the game socket scripted in the browser, as
// capture-battleship.mjs does for Battleship: a demo player at a round in
// its betting phase, made-up "Player NNNN" nicknames (the default form)
// and amounts in grumbles. Writes 2x WebP files, English and Russian, to
// apps/landing-web/src/assets/roulette.
//
//   pnpm --filter "@outegro/roulette-web^..." build
//   pnpm --filter @outegro/roulette-web build
//   node tools/quality/capture-roulette.mjs [--png <dir>]
//
// --png also keeps the full-size PNG captures for review.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps/roulette-web");
const out = path.join(root, "apps/landing-web/src/assets/roulette");
const pngFlag = process.argv.indexOf("--png");
const pngDir = pngFlag > 0 ? path.resolve(process.argv[pngFlag + 1]) : null;

const { colorOf, defaultLimits, defaultTimings, multipliers } = await import(
  pathToFileURL(path.join(root, "packages/roulette-engine/dist/index.js")).href
);

// Own ports, away from the app's dev port (3007) and the backends' (4001...).
const APP_PORT = 3296;
const PORTS = { roulette: 4296, auth: 4297, wallet: 4298, daily: 4299 };
const APP = `http://localhost:${APP_PORT}`;
const at = (port) => `http://localhost:${port}`;
const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

/* ---------- Made-up table ---------- */

const PLAYER = "Player 4127";
const BALANCE = 12_480;
// The last 20 results, newest first (made up; colours from the engine).
const LAST = [9, 1, 8, 6, 0, 13, 6, 9, 1, 5, 12, 3, 14, 7, 10, 2, 11, 4, 8, 6];
const history = LAST.map((number, i) => ({
  round: 4820 - i,
  number,
  color: colorOf(number),
}));
const ROUND = history[0].round + 1;

const line = (nickname, amount, betId = randomUUID()) => ({
  betId,
  nickname,
  amount,
});
const totalsOf = (lines, extra) => ({
  count: lines.length + extra.count,
  sum: lines.reduce((sum, bet) => sum + bet.amount, 0) + extra.sum,
  top: lines.slice(0, 7),
});
const ownBet = {
  betId: randomUUID(),
  clientBetId: randomUUID(),
  round: ROUND,
  color: "red",
  amount: 250,
};
const totals = {
  red: totalsOf(
    [
      line("Player 2093", 1_500),
      line("Player 7710", 900),
      line("Player 1386", 600),
      // The player's own bet, listed by its id: the column marks it.
      line(PLAYER, ownBet.amount, ownBet.betId),
      line("Player 5402", 200),
      line("Player 8861", 120),
      line("Player 3175", 50),
    ],
    { count: 2, sum: 60 },
  ),
  black: totalsOf(
    [
      line("Player 6248", 2_000),
      line("Player 1904", 750),
      line("Player 9532", 400),
      line("Player 2617", 300),
      line("Player 7083", 100),
    ],
    { count: 0, sum: 0 },
  ),
  green: totalsOf(
    [line("Player 4459", 150), line("Player 1270", 40), line("Player 8316", 20)],
    { count: 0, sum: 0 },
  ),
};
const table = {
  minBet: defaultLimits.minBet,
  maxBet: defaultLimits.maxBet,
  betsPerRound: defaultLimits.betsPerRound,
  payoutLimitPerColor: defaultLimits.payoutLimitPerColor,
  multipliers: { ...multipliers },
  timings: { ...defaultTimings },
};

/** The round in its betting phase, `left` ms before bets close. */
function bettingRound(left) {
  const now = Date.now();
  const ends = now + left;
  return {
    round: ROUND,
    phase: "betting",
    bettingEndsAt: new Date(ends).toISOString(),
    rollingAt: new Date(ends + table.timings.lockedMs).toISOString(),
    settleAt: null,
    nextRoundAt: null,
    result: null,
    totals,
    table: { paused: false, maintenance: false },
  };
}

/* ---------- Fake platform (server side of the BFF) ---------- */

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const routes = {
  roulette(req, res, url) {
    if (url.pathname === "/v1/me")
      return json(res, 200, {
        userId: randomUUID(),
        nickname: PLAYER,
        balance: BALANCE,
        unit: "GRM",
      });
    if (url.pathname === "/v1/rounds")
      return json(res, 200, { items: history, nextCursor: null });
    if (url.pathname === "/v1/ws-tickets" && req.method === "POST")
      return json(res, 200, {
        ticket: randomUUID().replaceAll("-", "").repeat(2),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
      });
    return json(res, 404, { error: "not_found" });
  },
  auth(_req, res, url) {
    if (url.pathname === "/v1/me")
      return json(res, 200, {
        email: null,
        displayName: "Demo player",
        roles: [],
      });
    return json(res, 401, { error: "unauthorized" });
  },
  wallet(_req, res, url) {
    if (url.pathname === "/v1/me/wallet")
      return json(res, 200, {
        unit: "GRM",
        balance: String(BALANCE),
        state: "active",
        exists: true,
        updatedAt: new Date().toISOString(),
      });
    return json(res, 404, { error: "not_found" });
  },
  daily(_req, res, url) {
    if (url.pathname === "/v1/daily")
      return json(res, 200, {
        available: false,
        nextAt: new Date(Date.now() + 9 * 3_600_000).toISOString(),
        blocked: null,
        streak: 0,
        streakBonusPercent: 0,
        prizes: [],
      });
    return json(res, 404, { error: "not_found" });
  },
};

const servers = Object.entries(PORTS).map(([name, port]) =>
  http
    .createServer((req, res) => {
      req.resume();
      routes[name](req, res, new URL(req.url ?? "/", at(port)));
    })
    .listen(port),
);

/* ---------- The app ---------- */

let app;
function stop() {
  for (const server of servers) server.close();
  if (!app || app.exitCode !== null) return;
  // start-standalone.mjs spawns server.js: stop the whole tree.
  if (process.platform === "win32")
    spawnSync("taskkill", ["/pid", String(app.pid), "/T", "/F"]);
  else process.kill(-app.pid, "SIGTERM");
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

/** An access token the BFF reads as fresh (it only looks at `exp`). */
function demoToken() {
  const part = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return `${part({ alg: "none", typ: "JWT" })}.${part({ sub: "demo", exp })}.demo`;
}

/** The game socket, scripted: a session at a round taking bets. */
function scriptSocket(ws) {
  const send = (type, payload, ref) =>
    ws.send(JSON.stringify(ref ? { type, ref, payload } : { type, payload }));
  ws.onMessage((raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === "ping")
      send(
        "pong",
        { t: message.payload.t, serverTime: new Date().toISOString() },
        message.seq,
      );
  });
  send("session.ready", {
    player: { nickname: PLAYER, balance: BALANCE },
    table,
    round: bettingRound(13_400),
    yourBets: [ownBet],
    history,
    serverTime: new Date().toISOString(),
  });
}

/*
 * The landing prints these shots through its own filter and dot screen, so
 * the page's grain would moiré under it and make every file heavier (noise
 * does not compress). The captures keep the paper colour, not the texture.
 */
const PLAIN_PAPER = `body { background-image: none !important; }`;

async function shoot(browser, { locale, viewport, name }) {
  const mobile = viewport === phone;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: locale === "ru" ? "ru-RU" : "en-US",
    colorScheme: "light",
    hasTouch: mobile,
    isMobile: mobile,
  });
  await context.addCookies([
    { name: "og_locale", value: locale, domain: "localhost", path: "/" },
    { name: "og_at", value: demoToken(), domain: "localhost", path: "/" },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("pageerror:", error.message));
  await page.routeWebSocket(/\/ws\?ticket=/, scriptSocket);
  await page.goto(`${APP}/`);
  await page.getByTestId("roulette").waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".rl-conn[data-status]"),
  );
  await page.addStyleTag({ content: PLAIN_PAPER });
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await save(await page.screenshot(), name);
  await context.close();
}

await mkdir(out, { recursive: true });
if (pngDir) await mkdir(pngDir, { recursive: true });

let browser;
try {
  app = spawn(
    process.execPath,
    ["../../tools/dev/start-standalone.mjs", String(APP_PORT)],
    {
      cwd: appDir,
      env: {
        ...process.env,
        HOSTNAME: "0.0.0.0",
        APP_URL: APP,
        ROULETTE_API_URL: at(PORTS.roulette),
        GAME_WS_URL: `ws://localhost:${PORTS.roulette}`,
        AUTH_API_URL: at(PORTS.auth),
        ID_URL: at(PORTS.auth),
        WALLET_API_URL: at(PORTS.wallet),
        DAILY_API_URL: at(PORTS.daily),
        SITE_URL: `${at(PORTS.auth)}/site`,
        CLIENT_IP_SOURCE: "x-forwarded-for",
      },
      stdio: ["ignore", "ignore", "inherit"],
      detached: process.platform !== "win32",
    },
  );
  await waitFor(`${APP}/health`);
  browser = await chromium.launch();
  for (const locale of ["en", "ru"]) {
    await shoot(browser, { locale, viewport: desktop, name: `table-${locale}` });
    await shoot(browser, { locale, viewport: phone, name: `phone-${locale}` });
  }
} finally {
  await browser?.close();
  stop();
}
