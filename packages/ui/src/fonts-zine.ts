import localFont from "next/font/local";

/*
 * The "zine" theme faces: an old-magazine mix on top of the brand ones.
 * Fontsource files (SIL Open Font License; the faces only the landing sets
 * cut down in fonts/, see below) served from the app origin, split
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
 * and saved no shift. The stamp face is texture only and heavy (2 KB a
 * glyph), so it is optional: a cold visit keeps its fallback for the page's
 * life instead of re-setting the stamps seconds in; the next one has it from
 * the cache.
 *
 * A face that a Russian page may set without a Latin letter (serif,
 * tabloid, loud, the display's 900, the condensed's regular) also has a
 * common cut: the spaces, figures and the punctuation of running text,
 * from its Latin file. On a Russian page the tokens put it between
 * the Cyrillic and the Latin file (zine.css, zine-page.css), so that page
 * fetches the Latin file only for Latin letters; other pages have it all in
 * the Latin file and never ask for it. The display's and the condensed's
 * other weights set Latin on every page (the name and its byline, EN / RU),
 * so their cut has the one weight, and zine-page.css keeps it to the text
 * set in that weight. The stamp keeps its spaces apart instead (see
 * stampSpace).
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
 *   --og-serif-*: og-serif (Source Serif 4, regular, with optical sizes:
 *     the lede's size follows the screen) — the vintage cover's lede and
 *     the masthead links (16px)
 *   --og-display-*: noto-serif in three fixed cuts — the cover's heavy
 *     narrow headline (900 at 62.5% width), the masthead's name (700 at 82%)
 *     and its byline (400 italic) (24px)
 *   --og-cond-*: fira-sans-condensed — spaced caps on the cover's buttons
 *     and labels (11px)
 * The calm level reads in Manrope from fonts.ts. The retired faces (kitsch,
 * drip, glitch, pixel, marker) keep their --font-* names in zine.css.
 *
 * fonts/ holds the faces only the landing sets (hand, stamp, serif,
 * display, cond), cut to what its two languages set in them: Russian
 * Cyrillic (А–я, Ё, ё, №) and the Fontsource Latin range less the accented
 * letters and lone marks (the landing sets none of them in these faces; one
 * would come from the fallback), with the features a browser applies by
 * default less locl, which has no lookup for either language; and the
 * common cuts: a Latin file's spaces, figures, ASCII punctuation, «», ·,
 * dashes, quotes and the ellipsis. Their unicode-ranges below are the cuts,
 * and each sets the landing's strings pixel for pixel as its source does.
 * Made with fontTools (varLib.instancer for the variable ones, then subset,
 * woff2); their licence is fonts/OFL.txt.
 *   noto-serif-*: @fontsource-variable/noto-serif 5.3.0, the wdth files,
 *     static at wght 900 wdth 62.5 (Latin and Cyrillic), wght 700 wdth 82
 *     and wght 400 wdth 100 italic (Latin only: the name and the byline are
 *     Latin in both languages); the common cut comes from the 900 Latin one
 *   og-serif-*: @fontsource-variable/source-serif-4 5.3.1, the opsz files,
 *     wght pinned at 400, opsz 8–60 kept (the landing sets it from 15px up;
 *     cutting the axis there moves outlines by rounding for 3 KB); renamed,
 *     as the OFL asks of a changed copy of a face with a Reserved Font Name
 *     ("Source"); its common cut comes from the Latin one
 *   caveat-*, fira-sans-condensed-*: the Fontsource 5.3.0 files; the
 *     condensed's common cut comes from the 400 Latin one
 *   rubik-dirt-*: Fontsource 5.3.0 too, cut to the letters the stamps set
 *     (listed at stampMenuCyrillic): a letter that new stamp copy brings has
 *     to go into a cut, or it draws in the fallback
 *   og-tabloid-common-*, rubik-mono-one-common-*: from the Fontsource 5.3.0
 *     Latin files; the tabloid's renamed, "Playfair Display" being a
 *     Reserved Font Name too
 * Any other weight, width or style set in them takes the nearest cut.
 * @fontsource/caveat, @fontsource/fira-sans-condensed and
 * @fontsource/rubik-dirt stay dependencies of the kit as the sources of
 * their cuts; the landing's share card (og/card.tsx) also reads the
 * condensed's .woff files from there to build /og and /og/ru.
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

const tabloidCommon = localFont({
  src: [
    {
      path: "./fonts/og-tabloid-common-900-italic.woff2",
      weight: "900",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-tabloid-common",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026",
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

const loudCommon = localFont({
  src: [
    {
      path: "./fonts/rubik-mono-one-common-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-loud-common",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-0040, U+005B-005F, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026",
    },
  ],
});

/*
 * The stamp cuts hold the letters of what is stamped, as it is drawn (the
 * marks and the ransom letters in capitals): /stack's stamp and QC mark, the
 * 504 card's title, the ransom letters the seed cuts from this face (М and Н
 * of «Меню», E of "Menu", Е of the specimen's «Сделано от и до»), and the
 * kit specimen's marks, receipt, sample and glyphs, "--font-stamp" with them.
 * The face being that heavy, each script is split by where it is set: the
 * menu cut holds what /stack stamps (its two marks and the ransom letters
 * of its title), all a visit there fetches; the other cut holds the rest.
 * The 504 card's English title takes its T from the menu cut and so loses
 * its Th pair (a third of a pixel).
 */
const stampMenuCyrillic = localFont({
  src: [
    {
      path: "./fonts/rubik-dirt-menu-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-stamp-menu-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0401, U+0410, U+0412, U+0414-0415, U+041A, U+041C-0422, U+0428, U+042F",
    },
  ],
});

const stampCyrillic = localFont({
  src: [
    {
      path: "./fonts/rubik-dirt-cyrillic-400-normal.woff2",
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
      value:
        "U+0411, U+0430, U+0433, U+0435, U+0437-0438, U+043A-043B, U+043D-0441, U+0443, U+0447, U+044F",
    },
  ],
});

const stampMenuLatin = localFont({
  src: [
    {
      path: "./fonts/rubik-dirt-menu-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-stamp-menu-latin",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0041, U+0043-0045, U+0049, U+004E-0056",
    },
  ],
});

const stampLatin = localFont({
  src: [
    {
      path: "./fonts/rubik-dirt-latin-400-normal.woff2",
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
        "U+002D, U+0046, U+0048, U+004C, U+0061-0066, U+0068-0069, U+006B-0070, U+0072-0074",
    },
  ],
});

/*
 * The stamp's spaces in a file of their own, for both languages: a Russian
 * stamp fetches no Latin file for them. Not a common cut put before the
 * Latin file on a Russian page: an optional face that missed its moment
 * sends the browser on to the next face covering the character, which then
 * is fetched too. English lower case loses its few kerning pairs with the
 * space (a pixel a line).
 */
const stampSpace = localFont({
  src: [
    {
      path: "./fonts/rubik-dirt-space-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "optional",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-stamp-space",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0020, U+00A0",
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
      path: "./fonts/caveat-cyrillic-600-normal.woff2",
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
      value: "U+0401, U+0410-044F, U+0451, U+2116",
    },
  ],
});

const handLatin = localFont({
  src: [
    {
      path: "./fonts/caveat-latin-600-normal.woff2",
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
        "U+0020-007E, U+00A0-00BF, U+00D7, U+00F7, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});

const serifCyrillic = localFont({
  src: [
    {
      path: "./fonts/og-serif-cyrillic-400-normal-opsz.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-serif-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0401, U+0410-044F, U+0451, U+2116",
    },
  ],
});

const serifLatin = localFont({
  src: [
    {
      path: "./fonts/og-serif-latin-400-normal-opsz.woff2",
      weight: "400",
      style: "normal",
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
        "U+0020-007E, U+00A0-00BF, U+00D7, U+00F7, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});

const serifCommon = localFont({
  src: [
    {
      path: "./fonts/og-serif-common-400-normal-opsz.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-serif-common",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026",
    },
  ],
});

const condCyrillic = localFont({
  src: [
    {
      path: "./fonts/fira-sans-condensed-cyrillic-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/fira-sans-condensed-cyrillic-600-normal.woff2",
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
      value: "U+0401, U+0410-044F, U+0451, U+2116",
    },
  ],
});

const condLatin = localFont({
  src: [
    {
      path: "./fonts/fira-sans-condensed-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "./fonts/fira-sans-condensed-latin-600-normal.woff2",
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
        "U+0020-007E, U+00A0-00BF, U+00D7, U+00F7, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});

const condCommon = localFont({
  src: [
    {
      path: "./fonts/fira-sans-condensed-common-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-cond-common",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026",
    },
  ],
});

const displayCyrillic = localFont({
  src: [
    {
      path: "./fonts/noto-serif-cyrillic-900-normal-wdth62.5.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-display-cyrillic",
  declarations: [
    {
      prop: "unicode-range",
      value: "U+0401, U+0410-044F, U+0451, U+2116",
    },
  ],
});

const displayLatin = localFont({
  src: [
    {
      path: "./fonts/noto-serif-latin-900-normal-wdth62.5.woff2",
      weight: "900",
      style: "normal",
    },
    {
      path: "./fonts/noto-serif-latin-700-normal-wdth82.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "./fonts/noto-serif-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-display-latin",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-007E, U+00A0-00BF, U+00D7, U+00F7, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215",
    },
  ],
});

const displayCommon = localFont({
  src: [
    {
      path: "./fonts/noto-serif-common-900-normal-wdth62.5.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--og-display-common",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0020-0040, U+005B-0060, U+007B-007E, U+00A0, U+00AB, U+00B7, U+00BB, U+2013-2014, U+2018-201A, U+201C-201E, U+2026",
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
  tabloidCommon,
  loudCyrillic,
  loudLatin,
  loudCommon,
  stampMenuCyrillic,
  stampCyrillic,
  stampMenuLatin,
  stampLatin,
  stampSpace,
  typeCyrillic,
  typeLatin,
  handCyrillic,
  handLatin,
  serifCyrillic,
  serifLatin,
  serifCommon,
  condCyrillic,
  condLatin,
  condCommon,
  displayCyrillic,
  displayLatin,
  displayCommon,
]
  .map((font) => font.variable)
  .join(" ");
