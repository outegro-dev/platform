"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

/** A service that did not answer gets a retry, not a blank page. */
export default function RootError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("errors");
  return (
    <main id="main" className="app-main og-container">
      <section className="notice" role="alert">
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <div className="notice-actions">
          <Button size="lg" onClick={reset}>
            <ArrowClockwiseIcon />
            {t("retry")}
          </Button>
        </div>
      </section>
    </main>
  );
}
