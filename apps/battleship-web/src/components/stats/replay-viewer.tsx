"use client";

import { Button } from "@outegro/ui/button";
import {
  CaretLeftIcon,
  CaretRightIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { CellState, OwnShip } from "@/game/stores/match-store";
import type { MatchReplay, ReplayCursor } from "@/game/stores/stats-store";
import { BoardFrame, cellName, gridOf } from "../board/board-frame";
import { CellMark, ShotMarker } from "../board/marks";
import { BoardShip } from "../board/ship";
import { useRoot } from "../providers";

const ReplayBoard = observer(function ReplayBoard({
  label,
  view,
  highlight,
}: {
  label: string;
  view: { ships: OwnShip[]; cells: CellState[][] };
  highlight: { x: number; y: number } | null;
}) {
  const { session } = useRoot();
  const t = useTranslations("battle.cell");
  const { ships: skin, hitEffect, theme } = session.cosmetics;
  return (
    <BoardFrame
      label={label}
      theme={theme}
      cells={gridOf((x, y) => (
        <span className="cell">
          <span className="sr-only">
            {t(view.cells[y]?.[x] ?? "unknown", { cell: cellName(x, y) })}
          </span>
        </span>
      ))}
      ships={
        <>
          {view.ships.map((ship) => (
            <BoardShip
              key={`${ship.x}-${ship.y}-${ship.orientation}`}
              x={ship.x}
              y={ship.y}
              length={ship.length}
              orientation={ship.orientation}
              skin={skin}
              state={ship.sunk ? "wreck" : "idle"}
            />
          ))}
          {view.cells.flatMap((row, y) =>
            row.map((state, x) =>
              state === "unknown" ? null : (
                <CellMark
                  // biome-ignore lint/suspicious/noArrayIndexKey: cell coordinates
                  key={`${x}-${y}`}
                  x={x}
                  y={y}
                  kind={state}
                  effect={hitEffect}
                />
              ),
            ),
          )}
          {highlight ? (
            <ShotMarker
              key={`${highlight.x}-${highlight.y}`}
              x={highlight.x}
              y={highlight.y}
            />
          ) : null}
        </>
      }
    />
  );
});

const Controls = observer(function Controls({
  cursor,
}: {
  cursor: ReplayCursor;
}) {
  const t = useTranslations("replay");
  const outcome = useTranslations("battle.last.outcome");
  const move = cursor.current;
  return (
    <>
      <div className="replay-controls og-glass" data-testid="replay-controls">
        <div className="replay-buttons">
          <Button
            variant="ghost"
            size="icon"
            onClick={cursor.first}
            aria-label={t("first")}
            disabled={cursor.step === 0}
          >
            <SkipBackIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={cursor.prev}
            aria-label={t("prev")}
            disabled={cursor.step === 0}
          >
            <CaretLeftIcon />
          </Button>
          <Button
            size="icon"
            onClick={cursor.toggle}
            aria-label={cursor.playing ? t("pause") : t("play")}
            data-testid="replay-play"
          >
            {cursor.playing ? (
              <PauseIcon weight="fill" />
            ) : (
              <PlayIcon weight="fill" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={cursor.next}
            aria-label={t("next")}
            disabled={cursor.step >= cursor.total}
            data-testid="replay-next"
          >
            <CaretRightIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={cursor.last}
            aria-label={t("last")}
            disabled={cursor.step >= cursor.total}
          >
            <SkipForwardIcon />
          </Button>
        </div>
        <input
          type="range"
          className="replay-slider"
          min={0}
          max={cursor.total}
          value={cursor.step}
          onChange={(event) => cursor.seek(Number(event.target.value))}
          aria-label={t("slider")}
          aria-valuetext={t("step", { step: cursor.step, total: cursor.total })}
        />
        <span className="replay-step" data-testid="replay-step">
          {t("step", { step: cursor.step, total: cursor.total })}
        </span>
      </div>
      <p className="replay-move" aria-live="polite">
        {move
          ? t("move", {
              side: move.by === "you" ? t("you") : t("opponent"),
              cell: cellName(move.x, move.y),
              outcome: outcome(move.outcome),
            })
          : t("start")}
      </p>
    </>
  );
});

/** Steps through a finished match with both fleets revealed (Premium). */
export const ReplayViewer = observer(function ReplayViewer({
  replay,
}: {
  replay: MatchReplay;
}) {
  const root = useRoot();
  const t = useTranslations("replay");
  const p = useTranslations("play");
  const r = useTranslations("result");
  const levels = useTranslations("modes.levels");
  const [cursor] = useState(() => root.createStats().openReplay(replay));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, a, [role='slider']"))
        return;
      if (event.key === "ArrowRight") cursor.next();
      else if (event.key === "ArrowLeft") cursor.prev();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      cursor.dispose();
    };
  }, [cursor]);

  const opponent =
    replay.opponent.kind === "bot"
      ? p("botName", { level: levels(replay.opponent.level) })
      : replay.opponent.nickname;
  const current = cursor.current;
  const won = replay.winner === "you";
  return (
    <section
      className="match"
      aria-labelledby="replay-title"
      data-testid="replay"
    >
      <header className="page-head">
        <p className="og-eyebrow">{t("eyebrow")}</p>
        <h1 id="replay-title">
          {p("vs")} {opponent}
          <span className="og-accent">{won ? r("victory") : r("defeat")}</span>
        </h1>
        <p>{r(`reasons.${won ? "win" : "loss"}.${replay.reason}`)}</p>
      </header>
      <Controls cursor={cursor} />
      <div className="boards">
        <div className="board-column">
          <div className="board-caption">
            <h2>{t("yours")}</h2>
          </div>
          <ReplayBoard
            label={t("yours")}
            view={cursor.yours}
            highlight={current?.by === "opponent" ? current : null}
          />
        </div>
        <div className="board-column">
          <div className="board-caption">
            <h2>{t("theirs")}</h2>
          </div>
          <ReplayBoard
            label={t("theirs")}
            view={cursor.theirs}
            highlight={current?.by === "you" ? current : null}
          />
        </div>
      </div>
    </section>
  );
});
