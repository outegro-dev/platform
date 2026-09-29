"use client";

import { Button } from "@outegro/ui/button";
import {
  ArrowCounterClockwiseIcon,
  ArrowLeftIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { formatSigned } from "@/lib/format";
import { BoardLegend } from "../board/board-legend";
import { useRoot } from "../providers";
import { OwnBoard, TargetBoard } from "./boards";

const BURSTS = [
  { x: 18, y: 26, delay: 0, color: "var(--spark-gold)" },
  { x: 78, y: 20, delay: 280, color: "var(--spark-ice)" },
  { x: 55, y: 38, delay: 620, color: "var(--spark-ember)" },
  { x: 32, y: 14, delay: 900, color: "var(--spark-white)" },
  { x: 86, y: 44, delay: 1150, color: "var(--spark-gold)" },
];
const SPARKS = 14;

/** Victory fireworks: bursts of sparks, transform and opacity only. */
function Fireworks() {
  return (
    <div className="fireworks" aria-hidden="true">
      {BURSTS.map((burst) => (
        <span
          key={`${burst.x}-${burst.y}`}
          className="burst"
          style={
            {
              "--bx": `${burst.x}%`,
              "--by": `${burst.y}%`,
            } as CSSProperties
          }
        >
          {Array.from({ length: SPARKS }, (_, i) => (
            <i
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed spark set
              key={i}
              className="spark"
              style={
                {
                  "--i": i,
                  "--n": SPARKS,
                  "--delay": `${burst.delay + (i % 3) * 40}ms`,
                  "--reach": `${-70 - (i % 4) * 18}px`,
                  "--spark-color": burst.color,
                } as CSSProperties
              }
            />
          ))}
        </span>
      ))}
    </div>
  );
}

export const ResultScreen = observer(function ResultScreen() {
  const { match, lobby, session } = useRoot();
  const t = useTranslations("result");
  const locale = useLocale();
  const router = useRouter();
  const aborted = match.aborted;
  const won = match.won === true;
  const outcome = won ? "win" : "loss";
  const rating = match.rating;
  const level = match.botLevel;

  const toLobby = () => {
    match.leave();
    router.push("/");
  };

  if (aborted) {
    return (
      <section
        className="result"
        aria-labelledby="result-title"
        data-testid="result"
      >
        <div className="result-head">
          <h1 id="result-title">{t("cancelled")}</h1>
          <p data-testid="result-reason">{t(`aborted.${aborted}`)}</p>
        </div>
        <div className="result-actions">
          <Button size="lg" onClick={toLobby}>
            <ArrowLeftIcon />
            {t("toLobby")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="result"
      aria-labelledby="result-title"
      data-testid="result"
    >
      {won ? <Fireworks /> : null}
      <div className="result-head">
        <h1 id="result-title">
          {won ? (
            <span className="og-accent">{t("victory")}</span>
          ) : (
            t("defeat")
          )}
        </h1>
        <p data-testid="result-reason">
          {match.resultReason
            ? t(`reasons.${outcome}.${match.resultReason}`)
            : null}
        </p>
        <span
          className="rating-delta"
          data-sign={
            rating
              ? rating.delta > 0
                ? "up"
                : rating.delta < 0
                  ? "down"
                  : undefined
              : undefined
          }
          data-testid="rating-delta"
        >
          {rating ? (
            <>
              {formatSigned(rating.delta, locale)}
              <span className="small">
                {t("rating", { before: rating.before, after: rating.after })}
              </span>
            </>
          ) : (
            t("unrated")
          )}
        </span>
      </div>
      <dl className="result-stats">
        <div className="stat">
          <dt>{t("moves")}</dt>
          <dd>{match.moves}</dd>
        </div>
        <div className="stat">
          <dt>{t("sunk")}</dt>
          <dd>{match.shipsSunkByYou} / 10</dd>
        </div>
        <div className="stat">
          <dt>{t("hits")}</dt>
          <dd>{match.hitsByYou}</dd>
        </div>
        <div className="stat">
          <dt>{t("lost")}</dt>
          <dd>{match.shipsLost} / 10</dd>
        </div>
      </dl>
      <div className="result-actions">
        {level ? (
          <Button
            size="lg"
            onClick={() => lobby.startBot(level)}
            disabled={!session.online || lobby.isBusy("bot")}
            data-testid="play-again"
          >
            <ArrowCounterClockwiseIcon />
            {t("playAgain")}
          </Button>
        ) : match.mode === "quick" ? (
          <Button
            size="lg"
            onClick={() => {
              lobby.joinQueue();
              toLobby();
            }}
            disabled={!session.online}
          >
            <LightningIcon />
            {t("findAnother")}
          </Button>
        ) : null}
        <Button
          size="lg"
          variant="outline"
          onClick={toLobby}
          data-testid="back-to-lobby"
        >
          <ArrowLeftIcon />
          {t("toLobby")}
        </Button>
      </div>
      <div className="boards">
        <div className="board-column">
          <div className="board-caption">
            <h2>{t("yours")}</h2>
          </div>
          <OwnBoard size="lg" />
        </div>
        <div className="board-column">
          <div className="board-caption">
            <h2>{t("revealed")}</h2>
          </div>
          <TargetBoard interactive={false} />
        </div>
      </div>
      <BoardLegend mode="result" />
    </section>
  );
});
