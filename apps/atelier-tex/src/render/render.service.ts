import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import {
  type TexRenderRequest,
  type TexRenderResponse,
  texRenderResponseSchema,
} from "@outegro/contracts/atelier";
import { AppError, Metrics } from "@outegro/nest-common";
import { texConfig } from "../config/config.js";
import { type CvFont, loadAssets, type TexAssets } from "./assets.js";
import { buildContent, type CvContent } from "./content.js";
import {
  checkFonts,
  lastPageFill,
  logTail,
  measureBlocks,
  pagesWithTextOutside,
  parseBbox,
  parseLog,
  pdfPages,
} from "./measure.js";
import {
  Slots,
  SlotsBusyError,
  TOOL_RUNNER,
  type ToolRunner,
} from "./tools.js";

const MAX_WARNINGS = 200;
const A4 = { widthPt: 595.276, heightPt: 841.89 };

/**
 * What xelatex and poppler get from the environment: no secrets, a log that
 * never wraps (so one warning is one line) and no reading of files outside
 * the render folder and the TeX tree (`openin_any=p`), on top of
 * `-no-shell-escape` and the escaping of every text field.
 */
function toolEnv(): NodeJS.ProcessEnv {
  const keep = [
    "PATH",
    "HOME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "TEXMFVAR",
    "TEXMFCONFIG",
    "XDG_CACHE_HOME",
    "SystemRoot",
    "USERPROFILE",
  ];
  return {
    ...Object.fromEntries(
      keep.flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    ),
    max_print_line: "10000",
    error_line: "254",
    half_error_line: "238",
    openin_any: "p",
    openout_any: "p",
  };
}

type Outcome = "ok" | "compile_error" | "timeout" | "busy" | "failed";

/**
 * One render: content.tex from the CvDocument, two xelatex runs in a
 * temporary folder, then pages, fonts, block lines and last-page fill read
 * back with poppler. The folder is removed whatever happens.
 */
@Injectable()
export class RenderService implements OnModuleInit {
  private readonly logger = new Logger("Render");
  private readonly slots: Slots;
  private assets: TexAssets | undefined;
  private readonly renders;
  private readonly seconds;

  constructor(
    @Inject(texConfig.KEY)
    private readonly config: ConfigType<typeof texConfig>,
    @Inject(TOOL_RUNNER) private readonly tools: ToolRunner,
    @Inject(Metrics) metrics: Metrics,
  ) {
    this.slots = new Slots(config.concurrency, config.queueMax);
    this.renders = metrics.counter({
      name: "atelier_tex_renders_total",
      help: "CV renders by outcome.",
      labelNames: ["outcome"],
    });
    this.seconds = metrics.histogram({
      name: "atelier_tex_render_seconds",
      help: "Two xelatex runs plus poppler, slot wait excluded.",
      buckets: [0.5, 1, 2, 3, 5, 8, 13, 20, 40, 60, 120],
    });
  }

  async onModuleInit() {
    this.assets = await loadAssets();
  }

  async render(request: TexRenderRequest): Promise<TexRenderResponse> {
    const content = buildContent(request.document);
    try {
      const response = await this.slots.run(() =>
        this.compile(content, request.font),
      );
      this.renders.inc({ outcome: "ok" });
      return response;
    } catch (error) {
      const outcome: Outcome =
        error instanceof SlotsBusyError
          ? "busy"
          : error instanceof AppError && error.code === "UNPROCESSABLE"
            ? error.message.includes("timed out")
              ? "timeout"
              : "compile_error"
            : "failed";
      this.renders.inc({ outcome });
      if (error instanceof SlotsBusyError)
        throw new AppError("RATE_LIMITED", {
          message: error.message,
          retryable: true,
        });
      throw error;
    }
  }

  private async compile(
    content: CvContent,
    font: CvFont,
  ): Promise<TexRenderResponse> {
    this.assets ??= await loadAssets();
    const assets = this.assets;
    const started = performance.now();
    const dir = await mkdtemp(join(this.config.workDir, "atelier-tex-"));
    try {
      await writeFile(join(dir, "cv.tex"), assets.template);
      await writeFile(join(dir, "content.tex"), content.tex);
      await linkFonts(assets.fonts[font].dir, join(dir, "fonts"));
      const env = toolEnv();
      const run = (command: string, args: string[]) =>
        this.tools.run(command, args, {
          cwd: dir,
          timeoutMs: this.config.timeoutMs,
          env,
        });

      for (let pass = 1; pass <= 2; pass++) {
        const result = await run("xelatex", [
          "-interaction=nonstopmode",
          "-halt-on-error",
          "-no-shell-escape",
          "-jobname=cv",
          `\\def\\CvFont{${font}}\\def\\ContentFile{content}\\def\\FontDir{fonts/}\\input{cv}`,
        ]);
        if (result.code === 0 && !result.timedOut) continue;
        const log = await readFile(join(dir, "cv.log"), "utf8").catch(
          () => result.output,
        );
        const message = result.timedOut
          ? `xelatex timed out after ${this.config.timeoutMs} ms`
          : `xelatex failed (exit ${result.code})`;
        // The log tail quotes CV text: it goes to the caller, never to logs.
        this.logger.warn({ font, pass, reason: message }, "CV compile failed");
        throw new AppError("UNPROCESSABLE", {
          message,
          fieldErrors: { log: [message, ...logTail(log)] },
        });
      }

      const pdfPath = join(dir, "cv.pdf");
      const tool = async (command: string, args: string[]) => {
        const result = await run(command, args);
        if (result.code !== 0 || result.timedOut)
          throw new Error(
            `${command} ${result.timedOut ? "timed out" : `exited ${result.code}`}: ${result.output.slice(-500)}`,
          );
        return result.output;
      };
      const info = await tool("pdfinfo", [pdfPath]);
      const fonts = await tool("pdffonts", [pdfPath]);
      await tool("pdftotext", [
        "-bbox-layout",
        pdfPath,
        join(dir, "bbox.html"),
      ]);
      const [pdf, log, bbox] = await Promise.all([
        readFile(pdfPath),
        readFile(join(dir, "cv.log"), "utf8"),
        readFile(join(dir, "bbox.html"), "utf8"),
      ]);

      const layout = parseBbox(bbox);
      const pages = pdfPages(info);
      const parsed = parseLog(log);
      const fontCheck = checkFonts(fonts, assets.fonts[font].postScriptNames);
      const measured = measureBlocks(layout, content.blocks);
      const warnings = [...parsed.warnings, ...fontCheck.problems];
      if (pages !== layout.pages.length)
        warnings.push(
          `pdfinfo counts ${pages} pages, pdftotext ${layout.pages.length}`,
        );
      if (
        layout.pages.some(
          (page) =>
            Math.abs(page.widthPt - A4.widthPt) > 1 ||
            Math.abs(page.heightPt - A4.heightPt) > 1,
        )
      )
        warnings.push("Page size is not A4");
      for (const page of pagesWithTextOutside(layout))
        warnings.push(`Text outside page ${page}`);
      for (const block of measured)
        if (block.lines === null)
          warnings.push(`Measurement unavailable: ${block.id}`);

      const seconds = (performance.now() - started) / 1000;
      this.seconds.observe(seconds);
      const unmeasured = measured.filter((block) => block.lines === null);
      this.logger.log(
        {
          font,
          pages,
          overfullPt: parsed.overfullPt,
          fontsOk: fontCheck.ok,
          blocks: measured.length,
          unmeasured: unmeasured.length,
          ms: Math.round(seconds * 1000),
        },
        "CV rendered",
      );
      return texRenderResponseSchema.parse({
        pdfBase64: pdf.toString("base64"),
        texSource: content.tex,
        pages,
        overfullPt: parsed.overfullPt,
        fontsOk: fontCheck.ok,
        blocks: measured.map((block) => ({
          id: block.id,
          lines: block.lines ?? 0,
        })),
        lastPageFill: lastPageFill(layout, assets.geometry),
        warnings: capWarnings(warnings),
      });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

/** The chosen family as `fonts/` of the render folder: a link, or a copy where links fail. */
async function linkFonts(source: string, target: string) {
  try {
    await symlink(source, target, "junction");
  } catch {
    await cp(source, target, { recursive: true });
  }
}

function capWarnings(warnings: string[]) {
  if (warnings.length <= MAX_WARNINGS) return warnings;
  const kept = warnings.slice(0, MAX_WARNINGS - 1);
  kept.push(`${warnings.length - kept.length} more warnings not shown`);
  return kept;
}
