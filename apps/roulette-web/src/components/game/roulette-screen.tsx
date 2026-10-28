"use client";

import { Button } from "@outegro/ui/button";
import { ArrowClockwiseIcon, SignInIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import type { RouletteStore } from "@/game/stores/roulette-store";
import { signInHref } from "@/lib/routes";
import { useLiveRound, useReducedMotion, useSound } from "../providers";
import { BetBar } from "./bet-bar";
import { Columns } from "./columns";
import { StripStage, TableFx } from "./fx";
import { HistoryBar } from "./history-bar";
import { PhaseBar } from "./phase-bar";

/** The game for a signed-in player: the live round over the socket. */
export const RouletteScreen = observer(function RouletteScreen() {
  const store = useLiveRound();
  const sound = useSound();
  const reducedMotion = useReducedMotion();
  const t = useTranslations("round");
  const phase = useTranslations("phase");
  const round = store.round;

  // A bet taken and a payout get their blip (only once the player has acted).
  const notice = store.notice;
  useEffect(() => {
    if (notice.kind === "accepted") sound.play("bet");
    if (notice.kind === "won") sound.play("win");
  }, [notice, sound]);

  return (
    <section className="rl" aria-labelledby="rl-title" data-testid="roulette">
      <h1 id="rl-title" className="sr-only">
        {round ? t("number", { round: round.round }) : "outegro"}
      </h1>
      <TableFx store={store} reducedMotion={reducedMotion} />
      <ConnectionNote store={store} />
      {round?.table.maintenance ? (
        <div className="rl-conn" role="status" data-status="maintenance">
          <span>{phase("maintenance")}</span>
        </div>
      ) : null}
      <PhaseBar round={round} table={store.table} clock={store.clock} />
      <StripStage store={store} reducedMotion={reducedMotion} />
      <HistoryBar history={store.history} />
      <BetBar store={store} sound={sound} />
      <Columns store={store} />
      <footer className="rl-foot">
        <span>{round ? t("number", { round: round.round }) : null}</span>
        {round ? (
          <Link href={`/fair?round=${round.round}`}>{t("check")}</Link>
        ) : null}
      </footer>
    </section>
  );
});

/** Shown while the socket is not up: what is happening and what to do. */
const ConnectionNote = observer(function ConnectionNote({
  store,
}: {
  store: RouletteStore;
}) {
  const t = useTranslations("connection");
  const { status } = store;
  if (status === "ready" || status === "idle" || status === "closed")
    return null;
  return (
    <div className="rl-conn" role="status" data-status={status}>
      <span>{t(status)}</span>
      {status === "unauthorized" ? (
        <Button asChild size="sm">
          <a href={signInHref("/")} rel="nofollow">
            <SignInIcon />
            {t("signInAgain")}
          </a>
        </Button>
      ) : status === "reconnecting" || status === "connecting" ? (
        <Button size="sm" variant="outline" onClick={store.retry}>
          <ArrowClockwiseIcon />
          {t("retry")}
        </Button>
      ) : null}
    </div>
  );
});
