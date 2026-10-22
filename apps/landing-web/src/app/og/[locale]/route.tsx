import { defaultLocale, isLocale, locales } from "@outegro/i18n/config";
import { card } from "../card";

// Rendered once per language at build time, as /og/<locale>; no other
// paths.
export const dynamic = "force-static";
export const dynamicParams = false;

/** Every language but the default one, which is /og itself. */
export function generateStaticParams() {
  return locales
    .filter((locale) => locale !== defaultLocale)
    .map((locale) => ({ locale }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/og/[locale]">,
) {
  const { locale } = await params;
  return card(isLocale(locale) ? locale : defaultLocale);
}
