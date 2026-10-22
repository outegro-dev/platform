// Screenshots of the landing and a local frame profile of the paper ride,
// written to docs/09-evidence/landing-build. Needs a running production
// preview: `pnpm start` (localhost:3000) or its base URL as the argument.
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const base = process.argv[2] ?? "http://localhost:3000";
const out = "docs/09-evidence/landing-build";
await mkdir(out, { recursive: true });
// A real GPU on Windows dev machines; elsewhere SwiftShader, and the ride stays paper steps (see playwright.config.ts).
const browser = await chromium.launch({ args: process.platform === "win32" ? ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : [] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
// A returning reader: past the gates, in this language (the URL never carries it).
const reader = (locale) => context.addCookies([{ name: "og_gate", value: "1", url: base }, { name: "og_locale", value: locale, url: base }]);
const hydrated = async (page) => {
  await page.locator("html[data-reveal-ready]").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
};
await reader("en");
const page = await context.newPage();
await page.addInitScript(() => {
  window.__lab = { lcp: 0, cls: 0 };
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lab.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__lab.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
});
await page.goto(base);
await hydrated(page);
await page.screenshot({ path: `${out}/desktop-en.png` });
// The profile runs in the middle of the ride, where the diorama draws (or its paper steps stand).
await page.locator("#process").evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
await page.locator("#process [role=img] canvas").waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(10000); // Deliberate warm-up for the frame profile.
const profile = await page.evaluate(() => new Promise(resolve => {
  const samples = []; let previous = performance.now(); const start = previous;
  function tick(now) { samples.push(now - previous); previous = now; if (now - start < 20000) requestAnimationFrame(tick); else {
    const sorted = [...samples].sort((a,b) => a-b);
    const canvas = document.querySelector("#process canvas"); const gl = canvas?.getContext("webgl2"); const info = gl?.getExtension("WEBGL_debug_renderer_info");
    resolve({ mode: "local headless Chromium, unthrottled, RAF intervals; not physical mobile certification", viewport: [innerWidth,innerHeight], dpr: devicePixelRatio, canvas: canvas ? [canvas.width,canvas.height] : "none: the paper steps", renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unavailable", warmupSeconds: 10, durationSeconds: (now-start)/1000, p50Ms: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)], over25msPercent: samples.filter(x=>x>25).length/samples.length*100, averageRafFps: samples.length/((now-start)/1000), load: window.__lab, samples });
  }} requestAnimationFrame(tick);
}));
await writeFile(`${out}/performance.json`, JSON.stringify(profile, null, 2));
// Reduced motion lays every part in its place: one still page.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(base);
await hydrated(page);
for (const id of ["top","projects","services","process","contact"]) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollTo(0,0));
await page.screenshot({ path: `${out}/desktop-full.png`, fullPage: true });
await page.emulateMedia({ reducedMotion: "no-preference" });
for (const locale of ["en","ru"]) {
  await reader(locale);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await hydrated(page);
  await page.screenshot({path:`${out}/mobile-${locale}.png`});
  await page.screenshot({path:`${out}/mobile-${locale}-full.png`,fullPage:true});
}
await page.setViewportSize({width:1440,height:900});
await page.goto(`${base}/design-system`);
await page.screenshot({path:`${out}/design-system.png`,fullPage:true});
console.log(JSON.stringify({...profile,samples:`${profile.samples.length} samples saved`},null,2));
await browser.close();
