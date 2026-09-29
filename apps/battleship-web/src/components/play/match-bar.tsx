"use client";

import { HourglassIcon, InfinityIcon, RobotIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { initialOf, PremiumBadge } from "../chrome/player-chip";
import { useRoot } from "../providers";
import { CountdownRing } from "./countdown-ring";

/** The opponent as a chip: a bot's level, or a human's nickname and rating. */
export const OpponentChip = observer(function OpponentChip() {
  const { match } = useRoot();
  const t = useTranslations("play");
  const p = useTranslations("player");
  const levels = useTranslations("modes.levels");
  const opponent = match.opponent;
  if (!opponent) return <span className="side-chip" data-side="opponent" />;
  const away = !match.opponentConnected;
  return (
    <div className="side-chip" data-side="opponent" data-testid="opponent-chip">
      {opponent.kind === "bot" ? (
        <span className="avatar" data-bot="" aria-hidden="true">
          <RobotIcon weight="fill" />
        </span>
      ) : (
        <span className="avatar" aria-hidden="true">
          {initialOf(opponent.nickname)}
        </span>
      )}
      <span className="side-chip-text">
        <span className="side-chip-name">
          {opponent.kind === "bot"
            ? t("botName", { level: levels(opponent.level) })
            : opponent.nickname}
        </span>
        <span className="side-chip-meta">
          {opponent.kind === "human" ? (
            <>
              {p("rating", { rating: opponent.rating })}
              {opponent.premium ? <PremiumBadge label={p("premium")} /> : null}
            </>
          ) : null}
          <span
            className="presence"
            data-away={away || undefined}
            aria-hidden="true"
          />
        </span>
      </span>
    </div>
  );
});

export const YouChip = observer(function YouChip() {
  const { session } = useRoot();
  const p = useTranslations("player");
  return (
    <div className="side-chip" data-side="you">
      <span className="avatar" aria-hidden="true">
        {initialOf(session.nickname)}
      </span>
      <span className="side-chip-text">
        <span className="side-chip-name">{session.nickname ?? p("you")}</span>
        <span className="side-chip-meta">
          {p("rating", { rating: session.rating ?? 0 })}
          {session.premium ? <PremiumBadge label={p("premium")} /> : null}
        </span>
      </span>
    </div>
  );
});

/** Whose turn it is, with the 30-second ring online (none against bots). */
export const TurnIndicator = observer(function TurnIndicator() {
  const { match } = useRoot();
  const t = useTranslations("battle");
  const yours = match.isYourTurn;
  const ms = match.msLeft;
  const seconds = match.secondsLeft;
  return (
    <div
      className="turn og-glass"
      data-testid="turn-indicator"
      data-turn={match.turn ?? "none"}
    >
      {ms !== null && seconds !== null && match.deadline ? (
        <CountdownRing
          key={match.deadline}
          msLeft={ms}
          totalMs={match.clockTotalMs}
          seconds={seconds}
          label={t("seconds", { seconds })}
        />
      ) : (
        <span className="ring-idle" title={t("noClock")}>
          {match.phase === "battle" ? (
            <InfinityIcon aria-label={t("noClock")} />
          ) : (
            <HourglassIcon aria-hidden="true" />
          )}
        </span>
      )}
      <span className="turn-text" aria-live="polite">
        <span
          className="turn-line"
          data-on={yours || undefined}
          aria-hidden={!yours}
        >
          <strong>{t("yourTurn")}</strong>
          <span>{t("yourTurnHint")}</span>
        </span>
        <span
          className="turn-line"
          data-on={!yours || undefined}
          aria-hidden={yours}
        >
          <strong>{t("theirTurn")}</strong>
          <span>{t("theirTurnHint")}</span>
        </span>
      </span>
    </div>
  );
});

export function MatchBar() {
  return (
    <div className="match-bar">
      <YouChip />
      <TurnIndicator />
      <OpponentChip />
    </div>
  );
}
