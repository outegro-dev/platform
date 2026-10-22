import { defaultLocale, isLocale } from "@outegro/i18n/config";
import type { Metadata } from "next";
import en from "@/messages/en.json";
import ru from "@/messages/ru.json";

// The share card's alt text by language: the helper gets the locale, not a
// translator.
const imageAlt = { en: en.meta.imageAlt, ru: ru.meta.imageAlt };

/**
 * Open Graph for one page. Next.js merges metadata shallowly: a page that
 * sets its own URL replaces the layout's whole openGraph object, so every
 * page builds the complete one here. The share card is drawn in each
 * language (app/og): the default one at /og, the others at /og/<locale>;
 * Next.js copies it, alt and all, into the Twitter card.
 */
export function openGraph(
  locale: string,
  page: { title: string; description: string; url: string },
): Metadata["openGraph"] {
  const language = isLocale(locale) ? locale : defaultLocale;
  return {
    ...page,
    siteName: "Nick Lukashik",
    type: "website",
    locale: language === "ru" ? "ru_RU" : "en_US",
    images: [
      {
        url: language === defaultLocale ? "/og" : `/og/${language}`,
        width: 1200,
        height: 630,
        alt: imageAlt[language],
      },
    ],
  };
}

/**
 * A page kept out of search (the kit's specimens, the sign-in error): its
 * own title and description, and none of the layout's canonical and share
 * cards, which are the home page's.
 */
export function unlisted(page: {
  title: string;
  description?: string;
}): Metadata {
  return {
    title: page.title,
    description: page.description ?? null,
    robots: { index: false, follow: false },
    alternates: null,
    openGraph: null,
    twitter: null,
  };
}
