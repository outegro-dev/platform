import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locale } from "@outegro/i18n/config";
import { ImageResponse } from "next/og";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";

const messages = { en, ru };

// Satori reads woff (not woff2), no variable fonts and no CSS variables, and
// its resvg draws no WebP. So: the cover's static cuts of Noto Serif as woff
// (fonts/, made from @outegro/ui's fonts/ with fontTools; licence there,
// OFL.txt), Fontsource files for the spaced caps, the cover's pictures made
// again at the size drawn here (art/, with sharp: the magazine and the
// cut-outs flattened onto the paper, the torn papers that lie over the
// magazine) and the cover's colours from zine-page.css. The card can only be
// a PNG, so the pictures come in 256-colour palettes: drawn one to one, they
// keep the card under the 300 KB messengers take for a preview (the
// full-colour photos made it 900 KB) and look the same at a preview's size.
// No grain on the paper for the same reason: a preview is too small to show
// it, and in a PNG noise only adds weight.
const here = path.join(process.cwd(), "src/app/og");
const fontsource = path.join(
  process.cwd(),
  "../../packages/ui/node_modules/@fontsource/fira-sans-condensed/files",
);
const paper = "#f6eede";
const ink = "#171512";
// the steps as on the cover's strip (.cover-steps): white with a halo of
// deeper red over the paler fibres
const stepInk = "#fff";
const stepHalo = "0 0 4px rgba(130, 24, 14, 0.6)";
const stepRule = "rgba(255, 236, 222, 0.5)";

const own = (file: string) => path.join(here, "fonts", `${file}.woff`);
const fira = (file: string) =>
  path.join(fontsource, `fira-sans-condensed-${file}.woff`);

// Satori takes one file per family, weight and style, so each script of a
// face is a family of its own and the text names both.
const faces: {
  name: string;
  file: string;
  weight: 400 | 600 | 700 | 900;
  style?: "normal" | "italic";
}[] = [
  {
    name: "Cover",
    file: own("noto-serif-latin-900-normal-wdth62.5"),
    weight: 900,
  },
  {
    name: "Cover Cyrillic",
    file: own("noto-serif-cyrillic-900-normal-wdth62.5"),
    weight: 900,
  },
  {
    name: "Name",
    file: own("noto-serif-latin-700-normal-wdth82"),
    weight: 700,
  },
  {
    name: "Name",
    file: own("noto-serif-latin-400-italic"),
    weight: 400,
    style: "italic",
  },
  { name: "Cond", file: fira("latin-600-normal"), weight: 600 },
  { name: "Cond Cyrillic", file: fira("cyrillic-600-normal"), weight: 600 },
];

// The headline's lead and its cut-out end per language: the Russian lead
// takes two lines, the English one a single one, so it sits lower.
const layout = {
  ru: { lead: 118, cut: { top: 360, width: 600, height: 153 } },
  en: { lead: 138, cut: { top: 284, width: 630, height: 190 } },
};

/** A picture of art/ as a data URL: nothing is served while it is drawn. */
async function picture(name: string) {
  const data = await readFile(path.join(here, "art", `${name}.png`));
  return `data:image/png;base64,${data.toString("base64")}`;
}

type Placed = {
  src: string;
  width: number;
  height: number;
  top: number;
  left?: number;
  right?: number;
};

/** A picture laid on the card at its place. */
function Picture({ src, width, height, ...place }: Placed) {
  return (
    // biome-ignore lint/performance/noImgElement: Satori draws plain images; next/image is for pages.
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      style={{ position: "absolute", ...place }}
    />
  );
}

/**
 * The share card: the first screen of the page as a vintage cover. The
 * heavy narrow headline with its end cut out of magazines, the magazine
 * lying on the right and the torn red strip with the way of the work along
 * the bottom, in one language; drawn once at build time.
 */
export async function card(locale: Locale) {
  const z = messages[locale].zine;
  const { lead, cut } = layout[locale];
  const [fonts, magazine, ending, strip, scrap] = await Promise.all([
    Promise.all(
      faces.map(async ({ file, style = "normal", ...face }) => ({
        ...face,
        style,
        // Read at build time only (both routes are static); left untraced,
        // a path this dynamic would pull the whole project into the server.
        data: await readFile(/*turbopackIgnore: true*/ file),
      })),
    ),
    picture("magazine"),
    picture(`cut-${locale}`),
    picture("strip"),
    picture("scrap"),
  ]);

  return new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "100%",
        background: paper,
        color: ink,
      }}
    >
      {/* the pictures flattened onto the paper go first, under the type */}
      <Picture src={magazine} width={500} height={567} top={20} left={688} />
      <Picture src={ending} {...cut} left={50} />

      <div
        style={{
          position: "absolute",
          top: 44,
          left: 56,
          display: "flex",
          alignItems: "center",
          width: 580,
          fontFamily: "Name",
          fontSize: 30,
        }}
      >
        <span style={{ marginRight: 8, fontStyle: "italic", fontWeight: 400 }}>
          by
        </span>
        <span style={{ fontWeight: 700 }}>Nick Lukashik</span>
        <div
          style={{ flex: 1, height: 1.5, marginLeft: 20, background: ink }}
        />
      </div>

      {/* drawn in the face's narrowest width and pressed a little more, as
          on the page (.cover-lead) */}
      <div
        style={{
          position: "absolute",
          top: lead,
          left: 56,
          display: "flex",
          width: 860,
          fontFamily: "Cover, Cover Cyrillic",
          fontSize: 150,
          fontWeight: 900,
          lineHeight: 0.79,
          letterSpacing: -2,
          transform: "scaleX(0.72)",
          transformOrigin: "left top",
        }}
      >
        {z.headlineLead}
      </div>

      <Picture src={strip} width={820} height={196} top={524} left={0} />
      <div
        style={{
          position: "absolute",
          top: 572,
          left: 56,
          display: "flex",
          alignItems: "center",
          width: 640,
          paddingTop: 12,
          borderTop: `1px solid ${stepRule}`,
          fontFamily: "Cond, Cond Cyrillic",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 2.6,
          textTransform: "uppercase",
          color: stepInk,
          textShadow: stepHalo,
        }}
      >
        {z.band.steps.map((step, i) => (
          <div
            key={step}
            style={{
              display: "flex",
              flexGrow: i ? 1 : 0,
              flexShrink: 0,
              alignItems: "center",
              whiteSpace: "nowrap",
            }}
          >
            {i > 0 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  margin: "0 10px",
                  background: stepRule,
                }}
              />
            )}
            {step}
          </div>
        ))}
      </div>
      <Picture src={scrap} width={70} height={117} top={540} right={0} />
    </div>,
    { width: 1200, height: 630, fonts },
  );
}
