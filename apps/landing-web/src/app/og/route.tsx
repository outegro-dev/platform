import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { generator, pick, seed, tilt } from "@/components/zine/random";
import en from "@/messages/en.json";

// Rendered once at build time: the zine faces are read from disk.
export const dynamic = "force-static";

// Satori reads woff (not woff2) and no CSS variables: Fontsource files and
// the zine palette from @outegro/ui zine.css, copied.
const fontsource = path.join(
  process.cwd(),
  "../../packages/ui/node_modules/@fontsource",
);
const ink = "#1b1915";
const inkSoft = "#4b4334";
const paper = "#efe4c6";
const paperWhite = "#fbf6e8";
const paperDeep = "#e3d3a8";
const red = "#cf3528";
const redDeep = "#a92619";
const blue = "#2360b5";
const yellow = "#f5c518";
const pink = "#f28fb1";

// The zine faces of fonts-zine.ts, minus the stamp (its woff alone is 370 KB).
const faces = [
  {
    name: "Mast",
    file: "ruslan-display/files/ruslan-display-latin-400-normal",
  },
  {
    name: "Loud",
    file: "rubik-mono-one/files/rubik-mono-one-latin-400-normal",
  },
  {
    name: "Tabloid",
    file: "playfair-display/files/playfair-display-latin-900-italic",
    style: "italic",
  },
  { name: "Sign", file: "unbounded/files/unbounded-latin-900-normal" },
  {
    name: "Body",
    file: "old-standard-tt/files/old-standard-tt-latin-700-normal",
  },
  { name: "Type", file: "pt-mono/files/pt-mono-latin-400-normal" },
  { name: "Hand", file: "caveat/files/caveat-latin-600-normal" },
] as const;
// Letters of the ransom headline are cut out of these faces and papers.
const cutFaces = ["Mast", "Loud", "Tabloid", "Sign", "Body"];
const papers = [
  { bg: paperWhite, fg: ink },
  { bg: yellow, fg: ink },
  { bg: ink, fg: paperWhite },
  { bg: redDeep, fg: paperWhite },
  { bg: blue, fg: paperWhite },
  { bg: paperDeep, fg: ink },
  { bg: pink, fg: ink },
];

/** The cover headline as a ransom note, seeded like the one on the page. */
function Ransom({ text }: { text: string }) {
  const next = generator(seed(text));
  return (
    <div style={{ display: "flex", flexWrap: "wrap", rowGap: 12, width: 860 }}>
      {text.split(" ").map((word, w) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: words can repeat; the position is the identity.
        <div key={w} style={{ display: "flex", gap: 3, marginRight: 26 }}>
          {[...word.toUpperCase()].map((letter, i) => {
            const face = pick(next, cutFaces);
            const sheet = pick(next, papers);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: letters repeat; the position is the identity.
                key={i}
                style={{
                  display: "flex",
                  padding: "2px 7px 6px",
                  fontFamily: face,
                  fontStyle: face === "Tabloid" ? "italic" : "normal",
                  fontSize: face === "Loud" ? 46 : 56,
                  lineHeight: 1,
                  color: sheet.fg,
                  background: sheet.bg,
                  boxShadow: "2px 3px 0 rgba(27, 25, 21, 0.3)",
                  transform: `rotate(${tilt(next, 7)}deg) translateY(${tilt(next, 5)}px)`,
                }}
              >
                {letter}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** A shop barcode whose bars come from the code, as in the zine bits. */
function Barcode({ code }: { code: string }) {
  const next = generator(seed(code));
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  while (x < 96) {
    const w = 1 + Math.floor(next() * 3);
    if (next() > 0.38) bars.push({ x, w });
    x += w + 1;
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "8px 10px 4px",
        background: paperWhite,
        fontFamily: "Type",
        fontSize: 13,
        letterSpacing: 3,
      }}
    >
      <div
        style={{
          display: "flex",
          position: "relative",
          width: 150,
          height: 44,
        }}
      >
        {bars.map((bar) => (
          <div
            key={bar.x}
            style={{
              position: "absolute",
              left: bar.x * 1.5,
              top: 0,
              width: bar.w * 1.5,
              height: 44,
              background: ink,
            }}
          />
        ))}
      </div>
      {code}
    </div>
  );
}

export async function GET() {
  const fonts = await Promise.all(
    faces.map(async (face) => ({
      name: face.name,
      data: await readFile(path.join(fontsource, `${face.file}.woff`)),
      style: "style" in face ? face.style : ("normal" as const),
    })),
  );
  const z = en.zine;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "30px 48px 0",
        background: paper,
        color: ink,
        fontFamily: "Body",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "7px 0 5px",
          borderTop: `3px solid ${ink}`,
          borderBottom: `3px solid ${ink}`,
          fontFamily: "Type",
          fontSize: 20,
          textTransform: "uppercase",
        }}
      >
        <span>{z.issue}</span>
        <span>{z.price}</span>
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 10,
          fontFamily: "Mast",
          fontSize: 132,
          lineHeight: 1,
          letterSpacing: -1,
          // the red and blue plates printed slightly off
          textShadow:
            "-4px 2px 0 rgba(216, 56, 42, 0.75), 4px -2px 0 rgba(35, 96, 181, 0.7)",
        }}
      >
        {z.mast.toUpperCase()}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: -10,
          marginLeft: 330,
          fontFamily: "Hand",
          fontSize: 36,
          color: blue,
          transform: "rotate(-2deg)",
        }}
      >
        {z.tagline}
      </div>

      <div style={{ display: "flex", marginTop: 34 }}>
        <Ransom text={z.headline} />
      </div>
      <div
        style={{
          display: "flex",
          marginTop: 26,
          fontSize: 25,
          color: inkSoft,
        }}
      >
        {en.footer.role} · outegro.dev
      </div>

      {/* the felt-tip price tag, hung crooked over the corner */}
      <div
        style={{
          position: "absolute",
          right: 46,
          bottom: 64,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: 270,
          padding: "30px 20px 28px",
          background: paperWhite,
          borderRadius: 8,
          boxShadow: `8px 10px 0 ${ink}`,
          transform: "rotate(-8deg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 125,
            width: 20,
            height: 20,
            borderRadius: 10,
            background: paper,
            border: `2px solid ${inkSoft}`,
          }}
        />
        <div
          style={{
            display: "flex",
            width: 230,
            marginTop: 10,
            borderTop: `2px solid ${red}`,
          }}
        />
        <div
          style={{
            display: "flex",
            marginTop: 4,
            fontFamily: "Hand",
            fontSize: 88,
            lineHeight: 1,
            transform: "rotate(-3deg)",
          }}
        >
          {z.tagPrice}
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: "Hand",
            fontSize: 32,
            color: red,
            transform: "rotate(-6deg)",
          }}
        >
          {z.tagNote}
        </div>
        <div
          style={{
            display: "flex",
            width: 230,
            marginTop: 8,
            borderTop: `2px solid ${red}`,
          }}
        />
      </div>

      {/* a sticker burst: two turned squares make an eight-point star */}
      <div
        style={{
          position: "absolute",
          right: 380,
          bottom: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 150,
          height: 150,
          transform: "rotate(10deg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 106,
            height: 106,
            background: yellow,
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 106,
            height: 106,
            background: yellow,
            transform: "rotate(45deg)",
          }}
        />
        <div
          style={{
            display: "flex",
            padding: "3px 8px",
            fontFamily: "Loud",
            fontSize: 20,
            color: paperWhite,
            background: redDeep,
            transform: "rotate(-6deg)",
          }}
        >
          {z.burst.toUpperCase()}
        </div>
      </div>

      <div
        style={{ position: "absolute", left: 48, bottom: 22, display: "flex" }}
      >
        <Barcode code="4 607001 770011" />
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );
}
