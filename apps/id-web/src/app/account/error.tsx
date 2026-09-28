"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

/** Outages show a retry, never an empty list pretending there is no data (TC-ID-09-03). */
export default function AccountError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("errors");
  return (
    <section className="notice" role="alert">
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      <Button size="lg" onClick={reset}>
        <ArrowClockwiseIcon />
        {t("retry")}
      </Button>
    </section>
  );
}
