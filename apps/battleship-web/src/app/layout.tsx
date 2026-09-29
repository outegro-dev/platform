import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { GameSvgDefs } from "@/components/board/svg-defs";
import { AppFooter } from "@/components/chrome/app-footer";
import { AppHeader } from "@/components/chrome/app-header";
import { TabBar } from "@/components/chrome/nav";
import { StatusPill } from "@/components/chrome/status-pill";
import { MatchFollower, RootStoreProvider } from "@/components/providers";
import { accessToken, loadProfile } from "@/lib/api";
import { gameSocketUrl } from "@/lib/env";
import { fontVariables } from "./fonts";
import "@outegro/ui/styles.css";
import "./globals.css";
import "./game.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    robots: { index: false, follow: false },
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
  const nav = await getTranslations("nav");
  const token = await accessToken();
  const profile = token ? await loadProfile() : null;
  const signedIn = Boolean(token) && profile?.status !== "signed-out";
  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <NextIntlClientProvider>
          <RootStoreProvider
            signedIn={signedIn}
            profile={profile?.status === "ok" ? profile.data : null}
            socketUrl={gameSocketUrl}
          >
            <GameSvgDefs />
            <a className="skip-link" href="#main">
              {nav("skip")}
            </a>
            <div className="app-shell">
              <AppHeader signedIn={signedIn} />
              {children}
              <AppFooter />
              <TabBar />
            </div>
            <StatusPill />
            <MatchFollower />
          </RootStoreProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
