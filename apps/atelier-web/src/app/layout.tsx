import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ActionStatusProvider } from "@/components/chrome/action-status";
import { NONCE_HEADER, THEME_COOKIE } from "@/lib/constants";
import { themeChoiceOf, themeScript } from "@/lib/theme";
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
  // The zine theme's paper and ink (--paper, --ink): metadata takes literal colours.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#efe4c6" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1915" },
  ],
  colorScheme: "light dark",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const theme = themeChoiceOf((await cookies()).get(THEME_COOKIE)?.value);
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    // The calm level of the kit's zine theme: newsprint, ink, hard shadows;
    // its dark tone (data-tone="dark", set before paint by the script) at
    // night. Dialogs and menus portaled to <body> take both from here.
    <html
      lang={locale}
      data-theme="zine-calm"
      data-theme-choice={theme}
      className={`${fontVariables} ${zineFontVariables}`}
      suppressHydrationWarning
    >
      <head>
        <script
          nonce={nonce}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script of this app, before the first paint.
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <NextIntlClientProvider>
          <ActionStatusProvider>{children}</ActionStatusProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
