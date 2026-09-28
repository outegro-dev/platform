import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// Rendered once at build time: brand fonts and the signature render are read from disk.
export const dynamic = "force-static";

const fonts = path.join(
  process.cwd(),
  "../../packages/ui/node_modules/@fontsource",
);

export async function GET() {
  const [manrope, cormorant, art] = await Promise.all([
    readFile(path.join(fonts, "manrope/files/manrope-latin-700-normal.woff")),
    readFile(
      path.join(
        fonts,
        "cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff",
      ),
    ),
    readFile(path.join(process.cwd(), "src/assets/og-signature.png")),
  ]);
  const src = `data:image/png;base64,${art.toString("base64")}`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#f2f2ef",
        color: "#171817",
        fontFamily: "Manrope",
        position: "relative",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: Satori renders plain img only. */}
      <img
        src={src}
        alt=""
        width={600}
        height={586}
        style={{ position: "absolute", right: 20, top: 22 }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          width: "100%",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, letterSpacing: -1.5 }}>
          Nick Lukashik
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}
        >
          <span style={{ fontSize: 120, letterSpacing: -8 }}>Depth in</span>
          <span
            style={{
              fontFamily: "Cormorant",
              fontStyle: "italic",
              fontSize: 128,
              letterSpacing: -3,
              color: "#6b6e69",
            }}
          >
            every detail.
          </span>
        </div>
        <div style={{ display: "flex", fontSize: 24, color: "#5b5d58" }}>
          Senior full-stack engineer · outegro.dev
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Manrope", data: manrope, weight: 700, style: "normal" },
        { name: "Cormorant", data: cormorant, weight: 500, style: "italic" },
      ],
    },
  );
}
