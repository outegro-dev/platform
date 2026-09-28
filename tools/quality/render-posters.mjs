// Renders the poster images from the live 3D scenes, so the fallback, the
// first paint and the OG image are the same objects at 2x resolution.
// Usage: start the app on :3000 (pnpm build && pnpm start), then
//   node tools/quality/render-posters.mjs [baseUrl]
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const base = process.argv[2] ?? "http://localhost:3000";
const assets = path.resolve("apps/landing-web/src/assets");
await mkdir(assets, { recursive: true });

const browser = await chromium.launch({
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=d3d11"],
});
const page = await browser.newPage({
  viewport: { width: 1700, height: 2400 },
  deviceScaleFactor: 2,
});
page.on("pageerror", (error) => console.error("pageerror:", error.message));
await page.goto(`${base}/design-system/scenes`);
await page.addStyleTag({
  content: "html,body{background:transparent!important}.silver-poster{display:none}",
});
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
});
console.log("renderer:", renderer);

for (const kind of ["signature", "knot", "wave"]) {
  const frame = page.locator(`#scene-${kind}`);
  await frame.locator('[data-scene-state="still"]').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1500);
  const png = await frame.screenshot({ omitBackground: true });
  const image = sharp(png);
  await image
    .clone()
    .webp({ quality: 90, alphaQuality: 95, effort: 6, smartSubsample: true })
    .toFile(path.join(assets, `${kind}.webp`));
  if (kind === "signature") {
    await image
      .clone()
      .resize({ width: 1200 })
      .flatten({ background: "#f2f2ef" })
      .png({ compressionLevel: 9 })
      .toFile(path.join(assets, "og-signature.png"));
  }
  const meta = await sharp(path.join(assets, `${kind}.webp`)).metadata();
  console.log(`${kind}: ${meta.width}x${meta.height}`);
}
await browser.close();
