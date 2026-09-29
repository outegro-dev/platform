import { fontVariables } from "@outegro/ui/fonts";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "@outegro/ui/styles.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("meta");
  return {
    metadataBase: new URL("https://outegro.dev"),
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/" },
    openGraph: {
      title: t("title"),
      description: t("description"),
      url: "/",
      siteName: "Nick Lukashik",
      type: "website",
      locale: locale === "ru" ? "ru_RU" : "en_US",
      images: [{ url: "/og", width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: "#f2f2ef",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
