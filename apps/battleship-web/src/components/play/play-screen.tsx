"use client";

import { Button } from "@outegro/ui/button";
import {
  AnchorSimpleIcon,
  ArrowClockwiseIcon,
  ClockCounterClockwiseIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { signInHref } from "@/lib/routes";
import { BoardFrame, gridOf } from "../board/board-frame";
import { useRoot } from "../providers";
import { BattleScreen } from "./battle-screen";
import { PlacementScreen } from "./placement-screen";
import { ResultScreen } from "./result-screen";

/** Same footprint as the battle screen, so the match fills it in place. */
function MatchSkeleton({ text }: { text: string }) {
  const t = useTranslations("play");
  return (
    <section className="match" aria-busy="true" data-testid="match-loading">
      <div className="match-bar">
        <span />
        <div className="turn og-glass">
          <span className="ring-idle">
            <span className="spinner" aria-hidden="true" />
          </span>
          <span className="turn-text" role="status">
            <span className="turn-line" data-on="">
              <strong>{text}</strong>
            </span>
          </span>
        </div>
        <span />
      </div>
      <div className="banner-slot" />
      <div className="boards">
        {[t("yourWaters"), t("enemyWaters")].map((label) => (
          <div key={label} className="board-column">
            <div className="board-caption">
              <h2>{label}</h2>
            </div>
            <BoardFrame
              label={label}
              theme="day"
              cells={gridOf(() => <span className="cell" />)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The match route: whatever phase the current match is in (placement,
 * battle, result), or a clear state when there is none or the connection
 * is not there yet.
 */
export const PlayScreen = observer(function PlayScreen() {
  const root = useRoot();
  const { match, session } = root;
  const t = useTranslations("play");
  const c = useTranslations("connection");

  if (match.endedWhileAway) {
    return (
      <section className="notice" data-testid="ended-away">
        <span className="notice-icon" aria-hidden="true">
          <ClockCounterClockwiseIcon />
        </span>
        <h1>{t("endedAway")}</h1>
        <p>{t("endedAwayBody")}</p>
        <div className="notice-actions">
          <Button asChild size="lg">
            <Link href="/" onClick={() => match.leave()}>
              {t("toLobby")}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/profile">{t("history")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  if (match.phase === "placement") return <PlacementScreen />;
  if (match.phase === "battle") return <BattleScreen />;
  if (match.phase === "finished") return <ResultScreen />;

  if (session.connection === "unauthorized") {
    return (
      <section className="notice">
        <h1>{c("unauthorized")}</h1>
        <div className="notice-actions">
          <Button asChild size="lg">
            <a href={signInHref("/play")}>{c("signInAgain")}</a>
          </Button>
        </div>
      </section>
    );
  }

  if (
    session.connection === "offline" ||
    (session.connection === "connecting" && session.attempts >= 2)
  ) {
    return (
      <section className="notice" data-testid="play-unavailable">
        <span className="notice-icon" aria-hidden="true">
          <WifiSlashIcon />
        </span>
        <h1>
          {session.connection === "offline" ? c("offline") : c("unavailable")}
        </h1>
        <div className="notice-actions">
          <Button size="lg" onClick={() => root.socket.retryNow()}>
            <ArrowClockwiseIcon />
            {c("retry")}
          </Button>
        </div>
      </section>
    );
  }

  const known = session.activeMatchId !== undefined;
  if (
    session.connection === "ready" &&
    known &&
    session.activeMatchId === null
  ) {
    return (
      <section className="notice" data-testid="no-match">
        <span className="notice-icon" aria-hidden="true">
          <AnchorSimpleIcon />
        </span>
        <h1>{t("noMatch")}</h1>
        <p>{t("noMatchBody")}</p>
        <div className="notice-actions">
          <Button asChild size="lg">
            <Link href="/">{t("toLobby")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  return (
    <MatchSkeleton
      text={session.connection === "ready" ? t("loading") : t("connecting")}
    />
  );
});
