import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ActionStatusProvider } from "@/components/chrome/action-status";
import { AppFooter } from "@/components/chrome/app-footer";
import { AppHeader } from "@/components/chrome/app-header";
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
  // The zine theme's paper (--paper): metadata takes a literal colour.
  themeColor: "#efe4c6",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const nav = await getTranslations("nav");
  return (
    // The calm level of the kit's zine theme: newsprint, ink, hard shadows.
    // Dialogs and menus portaled to <body> take it from here.
    <html
      lang={locale}
      data-theme="zine-calm"
      className={`${fontVariables} ${zineFontVariables}`}
    >
      <body>
        <NextIntlClientProvider>
          <ActionStatusProvider>
            <a className="skip-link" href="#main">
              {nav("skip")}
            </a>
            <div className="app-shell">
              <AppHeader />
              {children}
              <AppFooter />
            </div>
          </ActionStatusProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
