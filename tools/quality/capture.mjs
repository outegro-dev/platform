import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const out = "docs/09-evidence/landing-build";
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  window.__lab = { lcp: 0, cls: 0 };
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__lab.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__lab.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
});
await page.goto("http://localhost:3000/");
await page.locator('.signature[data-scene-state="running"]').waitFor();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(10000); // Deliberate warm-up for the frame profile.
await page.screenshot({ path: `${out}/desktop-en.png` });
const profile = await page.evaluate(() => new Promise(resolve => {
  const samples = []; let previous = performance.now(); const start = previous;
  function tick(now) { samples.push(now - previous); previous = now; if (now - start < 20000) requestAnimationFrame(tick); else {
    const sorted = [...samples].sort((a,b) => a-b);
    const canvas = document.querySelector("canvas"); const gl = canvas.getContext("webgl2"); const info = gl.getExtension("WEBGL_debug_renderer_info");
    resolve({ mode: "local headless Chromium, unthrottled, RAF intervals; not physical mobile certification", viewport: [innerWidth,innerHeight], dpr: devicePixelRatio, canvas: [canvas.width,canvas.height], renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unavailable", warmupSeconds: 10, durationSeconds: (now-start)/1000, p50Ms: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)], over25msPercent: samples.filter(x=>x>25).length/samples.length*100, averageRafFps: samples.length/((now-start)/1000), load: window.__lab, samples });
  }} requestAnimationFrame(tick);
}));
await writeFile(`${out}/performance.json`, JSON.stringify(profile, null, 2));
await page.emulateMedia({ reducedMotion: "reduce" });
for (const id of ["expertise","approach","projects","contact"]) await page.locator(`#${id}`).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollTo(0,0));
await page.screenshot({ path: `${out}/desktop-full.png`, fullPage: true });
for (const locale of ["en","ru"]) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://localhost:3000/${locale==="en"?"":"ru"}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path:`${out}/mobile-${locale}.png`});
  await page.screenshot({path:`${out}/mobile-${locale}-full.png`,fullPage:true});
}
await page.setViewportSize({width:1440,height:900});
await page.goto("http://localhost:3000/design-system");
await page.screenshot({path:`${out}/design-system.png`,fullPage:true});
console.log(JSON.stringify({...profile,samples:`${profile.samples.length} samples saved`},null,2));
await browser.close();
