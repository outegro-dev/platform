import type { Metadata } from "next";

/**
 * Open Graph for one page. Next.js merges metadata shallowly: a page that
 * sets its own URL replaces the layout's whole openGraph object, so every
 * page builds the complete one here.
 */
export function openGraph(
  locale: string,
  page: { title: string; description: string; url: string },
): Metadata["openGraph"] {
  return {
    ...page,
    siteName: "Nick Lukashik",
    type: "website",
    locale: locale === "ru" ? "ru_RU" : "en_US",
    images: [{ url: "/og", width: 1200, height: 630 }],
  };
}
