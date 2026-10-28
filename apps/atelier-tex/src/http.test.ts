import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { texRenderResponseSchema } from "@outegro/contracts/atelier";
import { configureApp } from "@outegro/nest-common";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ToolOptions, ToolResult, ToolRunner } from "./render/tools.js";
import { alexExample } from "./test/fixtures.js";

const token = "t".repeat(40);
const workDir = mkdtempSync(join(tmpdir(), "atelier-tex-http-"));
const fixture = (name: string) => new URL(`./test/${name}`, import.meta.url);

/**
 * Stands in for xelatex and poppler: writes what they would and answers with
 * the recorded alexExample render. `failCompile` makes xelatex stop on an
 * error; `slow` holds xelatex until released.
 */
class FakeTools implements ToolRunner {
  calls: string[] = [];
  failCompile = false;
  slow: Promise<void> | null = null;

  async run(
    command: string,
    args: string[],
    { cwd }: ToolOptions,
  ): Promise<ToolResult> {
    this.calls.push(command);
    const ok = { code: 0, output: "", timedOut: false };
    switch (command) {
      case "xelatex":
        if (this.slow) await this.slow;
        if (this.failCompile) {
          await writeFile(
            join(cwd, "cv.log"),
            "(./content.tex\n! Undefined control sequence.\nl.27 \\oops\n\nHere is how much of TeX's memory you used:\n",
          );
          return { ...ok, code: 1 };
        }
        await writeFile(join(cwd, "cv.pdf"), "%PDF-1.5 fake");
        await writeFile(
          join(cwd, "cv.log"),
          "Overfull \\hbox (1.5pt too wide) in paragraph at lines 3--4\n",
        );
        return ok;
      case "pdfinfo":
        return { ...ok, output: "Pages:           1\n" };
      case "pdffonts":
        return {
          ...ok,
          output: readFileSync(fixture("alex.pdffonts.txt"), "utf8"),
        };
      case "pdftotext":
        if (args[0] === "-bbox-layout")
          await copyFile(fixture("alex.bbox.xhtml"), args[2] as string);
        return ok;
      default:
        return ok;
    }
  }
}

describe("HTTP API", () => {
  const tools = new FakeTools();
  let app: NestExpressApplication;

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      PORT: "4999",
      METRICS_PORT: "0",
      LOG_LEVEL: "error",
      ATELIER_TEX_TOKEN: token,
      TEX_CONCURRENCY: "1",
      TEX_QUEUE_MAX: "1",
      TEX_WORK_DIR: workDir,
    });
    const { AppModule } = await import("./app.module.js");
    const { TOOL_RUNNER } = await import("./render/tools.js");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOOL_RUNNER)
      .useValue(tools)
      .compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    rmSync(workDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    tools.calls = [];
    tools.failCompile = false;
    tools.slow = null;
  });

  const render = (body: unknown) =>
    request(app.getHttpServer())
      .post("/v1/render")
      .set("authorization", `Bearer ${token}`)
      .send(body as object);

  it("renders and measures a CV", async () => {
    const response = await render({ document: alexExample });
    expect(response.status).toBe(200);
    const body = texRenderResponseSchema.parse(response.body);
    expect(Buffer.from(body.pdfBase64, "base64").toString()).toBe(
      "%PDF-1.5 fake",
    );
    expect(body.texSource).toContain("\\cvheader\n  {Alex Example}");
    expect(body).toMatchObject({
      pages: 1,
      overfullPt: 1.5,
      fontsOk: true,
      warnings: ["Overfull \\hbox (1.5pt too wide) in paragraph at lines 3--4"],
    });
    expect(body.lastPageFill).toBeCloseTo(0.587, 2);
    expect(body.blocks.map((block) => block.id)).toEqual([
      "summary:0",
      "summary:1",
      "skill:0",
      "skill:1",
      "skill:2",
      "skill:3",
      "bullet:nw1",
      "bullet:nw2",
      "bullet:nw3",
    ]);
    expect(body.blocks.every((block) => block.lines > 0)).toBe(true);
    expect(tools.calls).toEqual([
      "xelatex",
      "xelatex",
      "pdfinfo",
      "pdffonts",
      "pdftotext",
    ]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("checks the fonts of the requested family", async () => {
    const response = await render({ document: alexExample, font: "manrope" });
    expect(response.status).toBe(200);
    expect(response.body.fontsOk).toBe(false);
    expect(response.body.warnings).toContain(
      "Fallback font in PDF: IBMPlexSans",
    );
  });

  it("answers 422 with the log tail when LaTeX fails", async () => {
    tools.failCompile = true;
    const response = await render({ document: alexExample });
    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: "UNPROCESSABLE",
      retryable: false,
      fieldErrors: {
        log: [
          "xelatex failed (exit 1)",
          "! Undefined control sequence.",
          "l.27 \\oops",
          "",
        ],
      },
    });
    expect(tools.calls).toEqual(["xelatex"]);
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("refuses a missing or wrong token", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post("/v1/render")
      .send({ document: alexExample })
      .expect(401);
    await request(server)
      .post("/v1/render")
      .set("authorization", `Bearer ${"x".repeat(40)}`)
      .send({ document: alexExample })
      .expect(401);
  });

  it("validates the request against the contract", async () => {
    const response = await render({
      document: { ...alexExample, jobs: [] },
      font: "comic",
    });
    expect(response.status).toBe(400);
    expect(Object.keys(response.body.error.fieldErrors).sort()).toEqual([
      "document.jobs",
      "font",
    ]);
  });

  it("queues one render and refuses the next while the slot is busy", async () => {
    let release = () => {};
    tools.slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = render({ document: alexExample }).then((r) => r.status);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = render({ document: alexExample }).then((r) => r.status);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const third = await render({ document: alexExample });
    expect(third.status).toBe(429);
    expect(third.body.error).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
    });
    release();
    expect(await Promise.all([first, second])).toEqual([200, 200]);
  });

  it("reports health without a token", async () => {
    const response = await request(app.getHttpServer()).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      info: { xelatex: { status: "up" } },
    });
  });
});
