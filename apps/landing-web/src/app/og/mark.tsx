import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

// The cover's heavy narrow serif, the woff the share card draws with
// (card.tsx), and the cover's paper and red.
const face = path.join(
  process.cwd(),
  "src/app/og/fonts/noto-serif-latin-900-normal-wdth62.5.woff",
);
const paper = "#f6eede";
const red = "#cf3a2c";

/**
 * The site's mark at one size, for the tab icon and the home-screen icon:
 * the initials in the cover's headline face, red on its cream paper, as
 * large as the square holds so they still read at 16px.
 */
export async function mark(size: number) {
  // Read at build time only (the icons are static), like the card's faces.
  const data = await readFile(/*turbopackIgnore: true*/ face);
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        background: paper,
      }}
    >
      {/* pressed narrower, as the cover's headline is (.cover-lead) */}
      <span
        style={{
          fontFamily: "Cover",
          fontSize: size * 0.94,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: -size * 0.03,
          color: red,
          transform: "scaleX(0.72)",
        }}
      >
        NL
      </span>
    </div>,
    {
      width: size,
      height: size,
      fonts: [{ name: "Cover", data, weight: 900, style: "normal" }],
    },
  );
}
