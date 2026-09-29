import localFont from "next/font/local";

/*
 * Brand typefaces: the Fontsource files (SIL Open Font License) served by
 * next/font from this app's own origin, with the platform's variable names
 * (`--og-*`), so the tokens in globals.css resolve to them. Same faces and
 * settings as the shared `@outegro/ui/fonts` being introduced for id-web and
 * the landing; once it lands, this file can become a one-line re-export.
 *
 * Each typeface is split into Latin and Cyrillic with Fontsource's
 * unicode-range, so text pulls in only the scripts it uses. The tokens list
 * Cyrillic first, then Latin with its fallback, which therefore also stands
 * in for Cyrillic text until that file arrives:
 *   - Latin is preloaded: every page in both languages shows it (wordmark,
 *     eyebrows, emails). Its local fallback gets metrics matched to the face
 *     (adjustFontFallback), so the swap moves nothing;
 *   - Cyrillic loads on demand, so English pages never fetch it. Its glyphs
 *     are within 2% of the Latin average width, so the same fallback fits.
 * Static weights on purpose: the variable Manrope rendered too thin in
 * Windows WebKit. Options must be literals (next/font reads them at build
 * time), hence the repeated paths and ranges.
 */

const manropeCyrillic = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-cyrillic-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-cyrillic-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-cyrillic-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-manrope-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const manropeLatin = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/manrope/files/manrope-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  preload: true,
  adjustFontFallback: "Arial",
  variable: "--og-manrope-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const cormorantCyrillic = localFont({
  src: "../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-cyrillic-500-italic.woff2",
  weight: "500",
  style: "italic",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-cormorant-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

const cormorantLatin = localFont({
  src: "../../node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-500-italic.woff2",
  weight: "500",
  style: "italic",
  display: "swap",
  preload: true,
  adjustFontFallback: "Times New Roman",
  variable: "--og-cormorant-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

const monoCyrillic = localFont({
  src: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-500-normal.woff2",
  weight: "500",
  style: "normal",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-mono-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
    },
  ],
});

// next/font can only size Arial or Times New Roman to a face, and it does so
// by the average lowercase width: Arial came out 30–50% wider than JetBrains
// Mono for the uppercase labels and digits it sets, enough to wrap an
// eyebrow onto a second line. System monospace fonts share the fixed advance
// (0.55–0.6 em) instead, so they are the closer fallback here.
const monoLatin = localFont({
  src: "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2",
  weight: "500",
  style: "normal",
  display: "swap",
  preload: true,
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Menlo",
    "Consolas",
    "monospace",
  ],
  variable: "--og-mono-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

/**
 * Classes that define the font variables the design tokens read
 * (`--font-sans`, `--font-display`, `--font-mono`). Put them on `<html>`.
 */
export const fontVariables = [
  manropeCyrillic,
  manropeLatin,
  cormorantCyrillic,
  cormorantLatin,
  monoCyrillic,
  monoLatin,
]
  .map((font) => font.variable)
  .join(" ");
