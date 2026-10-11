import { fontVariables } from "@outegro/ui/fonts";
import { zineFontVariables } from "@outegro/ui/fonts-zine";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { userAgent } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { CONSENT_COOKIE, parseConsent } from "@/components/consent/consent";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { GtmBootstrap } from "@/components/consent/gtm-bootstrap";
import { GateLoader } from "@/components/zine/gate-loader";
import { env } from "@/lib/env";
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

// set by the gate loader when a visitor skips it (click or Esc)
const GATE_COOKIE = "og_gate";
// automation the isBot list misses: generic crawlers, headless browsers, audits
const AUTOMATION = /bot\b|crawler|spider|HeadlessChrome|Chrome-Lighthouse/i;

/** The port gates open on every page load, for people, until one skips them. */
async function gateDue() {
  const [jar, head] = await Promise.all([cookies(), headers()]);
  if (jar.has(GATE_COOKIE)) return false;
  const agent = userAgent({ headers: head });
  const ua = head.get("user-agent") ?? "";
  return ua !== "" && !agent.isBot && !AUTOMATION.test(ua);
}

/**
 * Reader statistics only once the owner sets GTM_ID; until then the page
 * is exactly as without them. The proxy's nonce lets the bootstrap run.
 */
async function analytics() {
  if (!env.GTM_ID) return null;
  const [jar, head] = await Promise.all([cookies(), headers()]);
  return {
    id: env.GTM_ID,
    nonce: head.get("x-nonce") ?? undefined,
    consent: parseConsent(jar.get(CONSENT_COOKIE)?.value),
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
  const [locale, gate, t, stats] = await Promise.all([
    getLocale(),
    gateDue(),
    getTranslations("loader"),
    analytics(),
  ]);
  return (
    <html
      lang={locale}
      className={`${fontVariables} ${zineFontVariables}`}
      data-theme="zine"
    >
      {stats && (
        <head>
          <GtmBootstrap {...stats} />
        </head>
      )}
      <body>
        {/* first in the body, so it is in the first streamed chunk over the page */}
        {gate && (
          <GateLoader
            cookie={GATE_COOKIE}
            pier={t("pier")}
            opening={t("opening")}
          />
        )}
        <NextIntlClientProvider>
          {/* before the skip link: the question comes ahead of the page */}
          {stats && !stats.consent && <ConsentBanner />}
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
