"use client";

import { Button } from "@outegro/ui/button";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { Consent } from "./consent";
import { saveConsent, useConsent } from "./use-consent";
import "./consent.css";

/**
 * The reader-statistics question: a note torn out of the paper and taped
 * to the bottom corner. Not a dialog, it never traps focus or blocks the
 * page. The layout renders it only while GTM is configured and no answer
 * is stored, first in <body> so keyboard and screen reader users meet it
 * before the page; the privacy page keeps the answer changeable.
 */
export function ConsentBanner() {
  const t = useTranslations("consent");
  const title = useId();
  const consent = useConsent();
  // what this note was told, for the live region left behind
  const [told, setTold] = useState<Consent>();
  const answer = (value: Consent) => {
    setTold(value);
    saveConsent(value);
  };
  return (
    <>
      {!consent && (
        <section className="consent" aria-labelledby={title}>
          <div className="consent-paper">
            <div className="consent-note">
              <p className="consent-kicker">{t("kicker")}</p>
              <p id={title} className="consent-title">
                {t("title")}
              </p>
              <p className="consent-body">
                {t.rich("body", {
                  settings: (chunks) => (
                    <a href="/privacy#analytics" className="consent-link">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
              <div className="consent-actions">
                <Button size="sm" onClick={() => answer("granted")}>
                  {t("accept")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => answer("denied")}
                >
                  {t("decline")}
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}
      <p role="status" className="sr-only">
        {told && t(`saved.${told}`)}
      </p>
    </>
  );
}
