"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

/**
 * Outside the account pages (sign-in, SSO entry) an unreachable service
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
    <div className="login-shell og-container">
      <header className="brand-header">
        <a href="/account" className="brand" aria-label={brand("home")}>
          <span className="brand-word">outegro</span>
          <span className="brand-product og-eyebrow">{brand("product")}</span>
        </a>
      </header>
      <main className="notice" id="main" role="alert">
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <Button size="lg" onClick={reset}>
          <ArrowClockwiseIcon />
          {t("retry")}
        </Button>
      </main>
    </div>
  );
}
