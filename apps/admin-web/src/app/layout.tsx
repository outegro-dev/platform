import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "@outegro/ui/styles.css";
import "./globals.css";
import { fontVariables } from "./fonts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: { default: t("title"), template: t("titleTemplate") },
    description: t("description"),
    // Also sent as X-Robots-Tag on every response (next.config.ts).
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false },
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#f2f2ef",
  colorScheme: "light",
};

/** Namespaces client components read; the rest stays on the server. */
const CLIENT_NAMESPACES = ["common", "actions", "idle", "shell", "replay"];

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(
    Object.entries(messages).filter(([key]) => CLIENT_NAMESPACES.includes(key)),
  );
  return (
    <html lang={locale} className={fontVariables}>
      <body>
        <NextIntlClientProvider messages={clientMessages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
