import { defaultLocale } from "@outegro/i18n/config";
import { card } from "./card";

// Rendered once at build time: the faces and pictures are read from disk.
export const dynamic = "force-static";

/** The share card in the default language, the one link previews get: they
 * carry no locale cookie. The other languages are at /og/<locale>. */
export function GET() {
  return card(defaultLocale);
}
