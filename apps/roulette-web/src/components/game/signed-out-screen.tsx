"use client";

import type { HistoryItem } from "@outegro/contracts/roulette";
import { Button } from "@outegro/ui/button";
import { SignInIcon } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { signInHref } from "@/lib/routes";
import { useReducedMotion } from "../providers";
import { HistoryBar } from "./history-bar";
import { StripView } from "./strip-view";

/**
 * A visitor who has not signed in: what the game is, a way in, and the
 * latest public results. No socket and no bets without an account.
 */
export function SignedOutScreen({
  history,
}: {
  history: HistoryItem[] | null;
}) {
  const t = useTranslations("signedOut");
  const reducedMotion = useReducedMotion();
  const last = history?.[0];
  return (
    <section className="rl" aria-labelledby="rl-title" data-testid="signed-out">
      <div className="rl-intro">
        <h1 id="rl-title">{t("title")}</h1>
        <p>{t("body")}</p>
        <Button asChild size="lg">
          <a href={signInHref("/")} rel="nofollow">
            <SignInIcon />
            {t("signIn")}
          </a>
        </Button>
      </div>
      <StripView
        rest={last ? { number: last.number } : null}
        spin={null}
        serverNow={Date.now}
        reducedMotion={reducedMotion}
      />
      <h2 className="rl-subtitle">{t("history")}</h2>
      {history ? (
        <HistoryBar history={history} />
      ) : (
        <div className="rl-histbar">
          <p className="rl-last">{t("unavailable")}</p>
        </div>
      )}
      <div className="rl-gap-bottom" />
    </section>
  );
}
