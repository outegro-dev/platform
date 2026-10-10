import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { openGraph } from "@/lib/metadata";
import "@outegro/ui/styles.css";
import "@outegro/ui/zine.css";
import "./globals.css";
import "./playful.css";
import "./zine-page.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("meta");
  return {
    metadataBase: new URL("https://outegro.dev"),
    title: t("title"),
    description: t("description"),
    alternates: { canonical: "/" },
    openGraph: openGraph(locale, {
      title: t("title"),
      description: t("description"),
      url: "/",
    }),
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: "#efe4c6",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${fontVariables} ${zineFontVariables}`}
      data-theme="zine"
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
