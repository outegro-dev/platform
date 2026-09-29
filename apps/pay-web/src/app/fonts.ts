import localFont from "next/font/local";

/*
 * Brand typefaces (Fontsource files, SIL Open Font License) served by
 * next/font from this app's own origin, under the platform's variable names
 * (`--og-*`) so the design tokens in globals.css resolve to them. Once
 * @outegro/ui ships the same setup as `@outegro/ui/fonts`, this file can be
 * replaced by that import.
 *
 * Latin and Cyrillic are separate faces with Fontsource's unicode-range: a
 * page downloads only the scripts it shows. Latin is preloaded and gets a
 * local fallback with matched metrics (adjustFontFallback), so the swap
 * moves nothing; Cyrillic loads on demand and uses the same fallback until
 * then. JetBrains Mono falls back to the system monospace instead: a
 * stretched Arial is far wider for the uppercase labels and digits it sets.
 * Static weights on purpose (the variable Manrope renders too thin in
 * Windows WebKit). Options must be literals: next/font reads them at build.
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

/** Classes defining the `--og-*` font variables; put them on `<html>`. */
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
