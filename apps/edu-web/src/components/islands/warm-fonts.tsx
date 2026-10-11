"use client";

import { useEffect } from "react";

/** Weights a chapter sets text in that the library and a book's page may not: bold words (700), the exercises' buttons (500). */
const WEIGHTS = ["500", "700"];
/** Russian and Latin: books in Russian mix both (code, product names). */
const SAMPLE = "Жж Aa";

/**
 * Each typeface weight loads when text first needs it (packages/ui/src/
 * fonts.ts). The library and a book's page set text in fewer weights than
 * a chapter does, so a chapter opened from them would show its first bold
 * words in the fallback and re-wrap them when the face arrives, moving the
 * text. These pages ask for those faces once they are up, so the chapter
 * opens in its own type.
 */
export function WarmFonts() {
  useEffect(() => {
    if (!document.fonts) return;
    const family = getComputedStyle(document.body).fontFamily;
    for (const weight of WEIGHTS)
      document.fonts
        .load(`${weight} 1em ${family}`, SAMPLE)
        .catch(() => undefined);
  }, []);
  return null;
}
