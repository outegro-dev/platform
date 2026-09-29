"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

/** Outside the console (sign-in): a retry instead of a bare error screen. */
export default function RootError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="auth-shell og-container">
      <header className="auth-head">
        <a href="/" className="brand-home" aria-label="outegro admin">
          <span className="brand-word">outegro</span>
        </a>
      </header>
      <main id="main" className="state" data-size="page" role="alert">
        <h1 className="state-title">{t("pageErrorTitle")}</h1>
        <p className="state-body">{t("pageErrorBody")}</p>
        <div className="state-actions">
          <Button onClick={reset}>
            <ArrowClockwiseIcon aria-hidden="true" />
            {t("retry")}
          </Button>
        </div>
      </main>
    </div>
  );
}
