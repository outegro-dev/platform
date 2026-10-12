import localFont from "next/font/local";

/*
 * The "zine" theme faces: an old-magazine mix on top of the brand ones.
 * Fontsource files (SIL Open Font License) served from the app origin, split
 * into Cyrillic and Latin by unicode-range like fonts.ts, none preloaded:
 * a page fetches only the faces and scripts it actually sets.
 * Options must be literals (next/font reads them at build time).
 *
 * So the faces arrive after the first paint, and what keeps the layout
 * still is the fallback: zine.css sets every token on a local font sized to
 * the face, per script ("og-*-fallback"), and the swap moves next to
 * nothing. Hence adjustFontFallback: false here: next/font sizes only Arial
 * or Times New Roman, by the Latin lower case, with no unicode-range, so a
 * Cyrillic fallback would capture Latin text too. Preloading the headline
 * faces measured worse: on Slow 4G it cost the first paint and LCP ~0.1 s
 * and saved no shift. The stamp face is texture only and heavy (300 KB
 * Latin), so it is optional: a cold visit keeps its fallback for the page's
 * life instead of re-setting the stamps seconds in; the next one has it from
 * the cache.
 *
 * Eleven faces, each with one job (smallest size it stays legible at):
 *   --og-body-*: old-standard-tt — loud body text, an old magazine column (17px)
 *   --og-mast-*: ruslan-display — masthead and big numbers (28px)
 *   --og-sign-*: unbounded — wide sign lettering for headlines (16px)
 *   --og-tabloid-*: playfair-display — tabloid italic accents (18px)
 *   --og-loud-*: rubik-mono-one — loud caps on buttons and kickers (11px)
 *   --og-stamp-*: rubik-dirt — rubber stamps, a word or two (22px)
 *   --og-type-*: pt-mono — typewriter labels and code (12px)
 *   --og-hand-*: caveat — notes in the margins (20px)
 *   --og-serif-*: source-serif-4 (variable, optical sizes) — the vintage
 *     cover's lede and the masthead links (16px)
 *   --og-display-*: noto-serif (variable, widths) — the cover's
 *     heavy narrow headline and the byline in the masthead (24px)
 *   --og-cond-*: fira-sans-condensed — spaced caps on the cover's buttons
 *     and labels (11px)
 * The calm level reads in Manrope from fonts.ts. The retired faces (kitsch,
 * drip, glitch, pixel, marker) keep their --font-* names in zine.css.
 */

const bodyCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-cyrillic-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-body-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const bodyLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
    {
      path: "../node_modules/@fontsource/old-standard-tt/files/old-standard-tt-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-body-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const mastCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/ruslan-display/files/ruslan-display-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-mast-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const mastLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/ruslan-display/files/ruslan-display-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-mast-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const signCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/unbounded/files/unbounded-cyrillic-900-normal.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-sign-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const signLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/unbounded/files/unbounded-latin-900-normal.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-sign-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const tabloidCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/playfair-display/files/playfair-display-cyrillic-900-italic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-tabloid-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const tabloidLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/playfair-display/files/playfair-display-latin-900-italic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-tabloid-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const loudCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-mono-one/files/rubik-mono-one-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-loud-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const loudLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-mono-one/files/rubik-mono-one-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-loud-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const stampCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-dirt/files/rubik-dirt-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-stamp-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const stampLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-dirt/files/rubik-dirt-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-stamp-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const typeCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/pt-mono/files/pt-mono-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-type-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const typeLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/pt-mono/files/pt-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-type-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const handCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-cyrillic-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-hand-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const handLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-hand-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const serifCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-cyrillic-opsz-normal.woff2",
      weight: "200 900",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-cyrillic-opsz-italic.woff2",
      weight: "200 900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-serif-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const serifLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-normal.woff2",
      weight: "200 900",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource-variable/source-serif-4/files/source-serif-4-latin-opsz-italic.woff2",
      weight: "200 900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-serif-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const condCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-cyrillic-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-cyrillic-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-cond-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const condLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/fira-sans-condensed/files/fira-sans-condensed-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-cond-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const displayCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/noto-serif/files/noto-serif-cyrillic-wdth-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource-variable/noto-serif/files/noto-serif-cyrillic-wdth-italic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-display-cyrillic",
  declarations: [
    { prop: "font-stretch", value: "62.5% 100%" },
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const displayLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource-variable/noto-serif/files/noto-serif-latin-wdth-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource-variable/noto-serif/files/noto-serif-latin-wdth-italic.woff2",
      weight: "100 900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-display-latin",
  declarations: [
    { prop: "font-stretch", value: "62.5% 100%" },
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

/** Put on <html> next to `fontVariables` to use the zine theme. */
export const zineFontVariables = [
  bodyCyrillic,
  bodyLatin,
  mastCyrillic,
  mastLatin,
  signCyrillic,
  signLatin,
  tabloidCyrillic,
  tabloidLatin,
  loudCyrillic,
  loudLatin,
  stampCyrillic,
  stampLatin,
  typeCyrillic,
  typeLatin,
  handCyrillic,
  handLatin,
  serifCyrillic,
  serifLatin,
  condCyrillic,
  condLatin,
  displayCyrillic,
  displayLatin,
]
  .map((font) => font.variable)
  .join(" ");
