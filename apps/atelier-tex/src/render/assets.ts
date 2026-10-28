import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { cvFontSchema } from "@outegro/contracts/atelier";
import type { z } from "zod";

export type CvFont = z.infer<typeof cvFontSchema>;

/** apps/atelier-tex: the same two levels up from src/render and dist/render. */
export const appRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The faces cv.tex loads for each `\CvFont` (regular, bold, name), by file.
 * Every one of them is printed on any CV, so the PDF must embed them all.
 */
export const fontFamilies: Record<CvFont, { dir: string; files: string[] }> = {
  plex: {
    dir: "ibm-plex-sans",
    files: [
      "IBMPlexSans-Regular.ttf",
      "IBMPlexSans-SemiBold.ttf",
      "IBMPlexSans-Bold.ttf",
    ],
  },
  manrope: {
    dir: "manrope",
    files: ["Manrope-Regular.ttf", "Manrope-Bold.ttf"],
  },
  atkinson: {
    dir: "atkinson-hyperlegible",
    files: [
      "AtkinsonHyperlegible-Regular.ttf",
      "AtkinsonHyperlegible-Bold.ttf",
    ],
  },
};

/** The text area of the page in PDF points (poppler: origin top left). */
export type PageGeometry = {
  heightPt: number;
  topPt: number;
  bottomPt: number;
};

export type TexAssets = {
  template: string;
  geometry: PageGeometry;
  fonts: Record<CvFont, { dir: string; postScriptNames: string[] }>;
};

const MM = 72 / 25.4;
const A4_HEIGHT_PT = 297 * MM;

/** Reads top and bottom margins from the template's geometry options. */
export function templateGeometry(template: string): PageGeometry {
  const options = template.match(/\\usepackage\[([^\]]*)\]\{geometry\}/)?.[1];
  const margin = (key: string) => {
    const value = options?.match(new RegExp(`\\b${key}=([\\d.]+)mm`))?.[1];
    if (!value) throw new Error(`cv.tex: geometry has no ${key} in mm`);
    return Number(value) * MM;
  };
  if (!options?.includes("a4paper")) throw new Error("cv.tex: not A4");
  return {
    heightPt: A4_HEIGHT_PT,
    topPt: margin("top"),
    bottomPt: margin("bottom"),
  };
}

/** PostScript name (name id 6) of a TrueType/OpenType font: what pdffonts prints. */
export function postScriptName(font: Buffer): string {
  const tables = font.readUInt16BE(4);
  let offset = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString("latin1", record, record + 4) === "name")
      offset = font.readUInt32BE(record + 8);
  }
  if (offset < 0) throw new Error("Font has no name table");
  const count = font.readUInt16BE(offset + 2);
  const strings = offset + font.readUInt16BE(offset + 4);
  let mac: string | undefined;
  for (let i = 0; i < count; i++) {
    const record = offset + 6 + i * 12;
    const platform = font.readUInt16BE(record);
    const nameId = font.readUInt16BE(record + 6);
    if (nameId !== 6) continue;
    const length = font.readUInt16BE(record + 8);
    const start = strings + font.readUInt16BE(record + 10);
    const raw = font.subarray(start, start + length);
    if (platform === 3 || platform === 0) {
      let name = "";
      for (let j = 0; j + 1 < raw.length; j += 2)
        name += String.fromCharCode(raw.readUInt16BE(j));
      return name;
    }
    if (platform === 1) mac = raw.toString("latin1");
  }
  if (mac) return mac;
  throw new Error("Font has no PostScript name");
}

/** Template, page geometry and font folders; fails at startup when one is missing. */
export async function loadAssets(root = appRoot): Promise<TexAssets> {
  const template = await readFile(join(root, "templates", "cv.tex"), "utf8");
  const fonts = {} as TexAssets["fonts"];
  for (const [font, family] of Object.entries(fontFamilies) as [
    CvFont,
    (typeof fontFamilies)[CvFont],
  ][]) {
    const dir = join(root, "fonts", family.dir);
    const postScriptNames = await Promise.all(
      family.files.map(async (file) =>
        postScriptName(await readFile(join(dir, file))),
      ),
    );
    fonts[font] = { dir, postScriptNames };
  }
  return { template, geometry: templateGeometry(template), fonts };
}
