import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/chrome/app-footer";
import { AppHeader } from "@/components/chrome/app-header";
import { DailyCorner } from "@/components/daily/daily-corner";
import { StoreProvider } from "@/components/providers";
import { accessToken, loadMe, loadWalletBalance } from "@/lib/api";
import { gameSocketUrl } from "@/lib/env";
import "@outegro/ui/styles.css";
import "@outegro/ui/zine.css";
import "./globals.css";
import "./roulette.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  // --ink of the zine theme: the page is the dark tone (metadata takes a literal colour)
  themeColor: "#1b1915",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const nav = await getTranslations("nav");
  const token = await accessToken();
  const me = token ? await loadMe() : null;
  // A session the backend refused is signed out; an unreachable backend is not.
  const signedIn = Boolean(token) && me?.status !== "signed-out";
  // The game may not know the balance (null): the wallet says it itself.
  const balance =
    me?.status === "ok"
      ? (me.data.balance ?? (await loadWalletBalance()))
      : null;
  return (
    // The calm zine level in its dark tone, as in the mock: ink paper,
    // newsprint letters, red shadows. Dialogs open at <body> and take it from here.
    <html
      lang={locale}
      data-theme="zine-calm"
      data-tone="dark"
      className={`${fontVariables} ${zineFontVariables}`}
    >
      <body>
        <NextIntlClientProvider>
          <StoreProvider
            player={
              me?.status === "ok"
                ? { nickname: me.data.nickname, balance }
                : null
            }
            socketUrl={gameSocketUrl}
          >
            <a className="skip-link" href="#main">
              {nav("skip")}
            </a>
            <div className="app-shell">
              <AppHeader signedIn={signedIn} />
              {children}
              <AppFooter />
            </div>
            {signedIn ? <DailyCorner /> : null}
          </StoreProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
