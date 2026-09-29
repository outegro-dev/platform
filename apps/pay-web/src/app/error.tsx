"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useTranslations } from "next-intl";

/**
 * Outside the signed-in pages (sign-in flow, notices) an unexpected failure
 * shows a retry instead of Next.js' bare error screen.
 */
export default function RootError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("errors");
  const brand = useTranslations("brand");
  return (
    <div className="shell">
      <header className="app-header bare-header og-container">
        <a href="/orders" className="brand" aria-label={brand("home")}>
          <span className="brand-word">outegro</span>
          <span className="brand-product og-eyebrow">{brand("product")}</span>
        </a>
      </header>
      <main id="main" className="app-main bare-main og-container">
        <section className="notice-page" role="alert">
          <h1>{t("title")}</h1>
          <p>{t("body")}</p>
          <Button size="lg" onClick={reset}>
            <ArrowClockwiseIcon aria-hidden="true" />
            {t("retry")}
          </Button>
        </section>
      </main>
    </div>
  );
}
