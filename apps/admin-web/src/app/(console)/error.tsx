"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";

/**
 * A page that failed as a whole (panels handle their own outages): say so
 * and retry, inside the console frame, never an empty screen.
 */
export default function ConsoleError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="state" data-kind="error" data-size="page" role="alert">
      <span className="state-icon" aria-hidden="true">
        <WarningCircleIcon />
      </span>
      <h1 className="state-title">{t("pageErrorTitle")}</h1>
      <p className="state-body">{t("pageErrorBody")}</p>
      <div className="state-actions">
        <Button onClick={reset}>
          <ArrowClockwiseIcon aria-hidden="true" />
          {t("retry")}
        </Button>
      </div>
    </div>
  );
}
