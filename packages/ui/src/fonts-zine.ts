import localFont from "next/font/local";

/*
 * The "zine" theme faces: an old-magazine mix on top of the brand ones.
 * Fontsource files (SIL Open Font License) served from the app origin, split
 * into Cyrillic and Latin by unicode-range like fonts.ts, none preloaded:
 * a page fetches only the faces and scripts it actually sets.
 * Options must be literals (next/font reads them at build time).
 *
 *   --og-body-*: old-standard-tt — body text, like an old magazine column
 *   --og-mast-*: ruslan-display — masthead
 *   --og-sign-*: unbounded — wide sign lettering for headlines ("Причал №1")
 *   --og-tabloid-*: playfair-display — tabloid italic headlines
 *   --og-kitsch-*: lobster — classified-ad kitsch
 *   --og-loud-*: rubik-mono-one — loud caps
 *   --og-stamp-*: rubik-dirt — rubber stamps
 *   --og-drip-*: rubik-wet-paint — dripping paint for errors
 *   --og-glitch-*: rubik-glitch — glitches
 *   --og-pixel-*: press-start-2p — pixel labels
 *   --og-type-*: pt-mono — typewriter labels
 *   --og-marker-*: pangolin — felt-tip marker for price tags
 *   --og-hand-*: caveat — notes in the margins
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

const kitschCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/lobster/files/lobster-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-kitsch-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const kitschLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/lobster/files/lobster-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-kitsch-latin",
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
  display: "swap",
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
  display: "swap",
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

const dripCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-wet-paint/files/rubik-wet-paint-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-drip-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const dripLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-wet-paint/files/rubik-wet-paint-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-drip-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const glitchCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-glitch/files/rubik-glitch-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-glitch-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const glitchLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/rubik-glitch/files/rubik-glitch-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-glitch-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const pixelCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/press-start-2p/files/press-start-2p-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-pixel-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const pixelLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-pixel-latin",
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

const markerCyrillic = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/pangolin/files/pangolin-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-marker-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const markerLatin = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/pangolin/files/pangolin-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-marker-latin",
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
  kitschCyrillic,
  kitschLatin,
  loudCyrillic,
  loudLatin,
  stampCyrillic,
  stampLatin,
  dripCyrillic,
  dripLatin,
  glitchCyrillic,
  glitchLatin,
  pixelCyrillic,
  pixelLatin,
  typeCyrillic,
  typeLatin,
  markerCyrillic,
  markerLatin,
  handCyrillic,
  handLatin,
]
  .map((font) => font.variable)
  .join(" ");
