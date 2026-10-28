import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CvDocument,
  type TexRenderResponse,
  texRenderResponseSchema,
} from "@outegro/contracts/atelier";
import { Metrics } from "@outegro/nest-common";
import { afterAll, describe, expect, it } from "vitest";
import { RenderService } from "./render/render.service.js";
import { SpawnToolRunner } from "./render/tools.js";
import { alexExample, qaTwoPager } from "./test/fixtures.js";

/**
 * A real XeLaTeX compile: through the running container (ATELIER_TEX_URL,
 * default http://localhost:4010, token from apps/atelier-tex/.env), else
 * with xelatex and poppler on this machine; skipped when neither exists.
 */
const url = process.env.ATELIER_TEX_URL ?? "http://localhost:4010";
const envFile = new URL("../.env", import.meta.url);
const token =
  process.env.ATELIER_TEX_TOKEN ??
  (existsSync(envFile)
    ? readFileSync(envFile, "utf8")
        .match(/^ATELIER_TEX_TOKEN=(.+)$/m)?.[1]
        ?.trim()
    : undefined);

async function containerUp() {
  if (!token) return false;
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const localTex = ["xelatex", "pdftotext", "pdfinfo", "pdffonts"].every(
  (tool) =>
    spawnSync(tool, [tool === "xelatex" ? "-version" : "-v"], {
      stdio: "ignore",
    }).status === 0,
);
const viaContainer = await containerUp();
const workDir = mkdtempSync(join(tmpdir(), "atelier-tex-it-"));

async function localRender(document: CvDocument, font: "plex" | "manrope") {
  const metrics = new Metrics({ service: "atelier-tex-test", port: 0 });
  const service = new RenderService(
    { concurrency: 1, queueMax: 4, timeoutMs: 60_000, workDir },
    new SpawnToolRunner(),
    metrics,
  );
  await service.onModuleInit();
  return service.render({ document, font });
}

async function render(
  document: CvDocument,
  font: "plex" | "manrope" = "plex",
): Promise<TexRenderResponse> {
  if (!viaContainer) return localRender(document, font);
  const response = await fetch(`${url}/v1/render`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ document, font }),
    signal: AbortSignal.timeout(120_000),
  });
  expect(response.status).toBe(200);
  return texRenderResponseSchema.parse(await response.json());
}

describe.skipIf(!viaContainer && !localTex)(
  `XeLaTeX render (${viaContainer ? url : "local xelatex"})`,
  () => {
    afterAll(() => rmSync(workDir, { recursive: true, force: true }));

    it("compiles the two-page sample within two pages, fonts embedded, every block measured", async () => {
      const result = await render(qaTwoPager);
      expect(result.pages).toBeGreaterThanOrEqual(1);
      expect(result.pages).toBeLessThanOrEqual(2);
      expect(result.fontsOk).toBe(true);
      expect(result.overfullPt).toBeLessThanOrEqual(2);
      const bullets = qaTwoPager.jobs.flatMap((job) => job.bullets);
      expect(result.blocks).toHaveLength(
        qaTwoPager.summary.length + qaTwoPager.skills.length + bullets.length,
      );
      for (const block of result.blocks)
        expect(block.lines, block.id).toBeGreaterThan(0);
      expect(
        result.warnings.filter((w) => w.startsWith("Measurement unavailable")),
      ).toEqual([]);
      expect(result.lastPageFill).toBeGreaterThan(0);
      expect(result.lastPageFill).toBeLessThan(1);
      expect(
        Buffer.from(result.pdfBase64, "base64").subarray(0, 5).toString(),
      ).toBe("%PDF-");
    });

    it("compiles every special character and another font", async () => {
      const result = await render(alexExample, "manrope");
      expect(result).toMatchObject({ pages: 1, fontsOk: true, warnings: [] });
      expect(result.blocks.every((block) => block.lines > 0)).toBe(true);
    });

    it("reports an unbreakable word as overfull", async () => {
      const result = await render({
        ...alexExample,
        jobs: [
          {
            ...(alexExample.jobs[0] as CvDocument["jobs"][number]),
            bullets: [{ id: "long", text: `Built ${"x".repeat(160)} once.` }],
          },
        ],
      });
      expect(result.overfullPt).toBeGreaterThan(10);
      expect(result.warnings.some((w) => w.startsWith("Overfull"))).toBe(true);
    });
  },
);
