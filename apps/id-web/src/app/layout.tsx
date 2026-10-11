import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ActionStatusProvider } from "@/components/action-status";
import "@outegro/ui/styles.css";
import "@outegro/ui/zine.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  // The zine theme's paper (--paper), for the browser's own chrome.
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
    // The calm level of the kit's zine theme; dialogs and menus portaled to
    // <body> take it from here.
    <html
      lang={locale}
      className={`${fontVariables} ${zineFontVariables}`}
      data-theme="zine-calm"
    >
      <body>
        <NextIntlClientProvider>
          <ActionStatusProvider>{children}</ActionStatusProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
