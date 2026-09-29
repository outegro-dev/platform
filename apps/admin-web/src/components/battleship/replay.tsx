"use client";

import { Button } from "@outegro/ui/button";
import {
  CaretDoubleLeftIcon,
  CaretDoubleRightIcon,
  CaretLeftIcon,
  CaretRightIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { afloat, type Placement, type Shot } from "@/lib/board";
import { coordinate } from "@/lib/format";
import { ReplayStore } from "@/stores/replay-store";
import { Board } from "./board";

type Props = {
  fleets: { a: Placement[] | null; b: Placement[] | null };
  moves: Shot[];
  names: { a: string; b: string };
};

/** Both boards after any move, stepped with buttons, the slider or the list. */
export const Replay = observer(function Replay({
  fleets,
  moves,
  names,
}: Props) {
  "use no memo";
  const t = useTranslations("replay");
  const [store] = useState(() => new ReplayStore(fleets, moves));
  const current = store.current;
  const step = store.step;
  const list = useRef<HTMLOListElement>(null);
  // Keep the current move visible in the list (its own scroll only, never
  // the page's): the last move on arrival, then whatever is stepped to.
  useEffect(() => {
    const container = list.current;
    const item = container?.children[step - 1];
    if (!container) return;
    if (!item) {
      container.scrollTop = 0;
      return;
    }
    const box = container.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.top < box.top) container.scrollTop -= box.top - rect.top + 4;
    else if (rect.bottom > box.bottom)
      container.scrollTop += rect.bottom - box.bottom + 4;
  }, [step]);
  const boardA = store.boardA;
  const boardB = store.boardB;
  const outcome = (shot: Shot) =>
    shot.outcome === "skip" ? t("skip") : t(`outcome.${shot.outcome}`);
  const describe = (shot: Shot) =>
    shot.x === null || shot.y === null
      ? t("skipped", { player: names[shot.side] })
      : t("shot", {
          player: names[shot.side],
          cell: coordinate(shot.x, shot.y),
          outcome: outcome(shot),
        });

  return (
    <div className="replay">
      <div className="boards">
        {(["a", "b"] as const).map((side) => {
          const board = side === "a" ? boardA : boardB;
          const fleet = fleets[side];
          const remaining = afloat(fleet, board);
          return (
            <figure key={side} className="board-figure">
              <Board
                board={board}
                label={t("boardLabel", {
                  player: names[side],
                  afloat: remaining,
                  total: fleet?.length ?? 0,
                })}
              />
              <figcaption className="board-caption">
                {names[side]}
                <span className="small muted">
                  {fleet
                    ? t("afloat", { afloat: remaining, total: fleet.length })
                    : t("hiddenFleet")}
                </span>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <p className="replay-status" aria-live="polite">
        {current
          ? `${t("step", { step: store.step, total: store.total })} · ${describe(current)}`
          : t("start", { total: store.total })}
      </p>
      <div className="replay-controls">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("first")}
          disabled={store.atStart}
          onClick={() => store.first()}
        >
          <CaretDoubleLeftIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("previous")}
          disabled={store.atStart}
          onClick={() => store.previous()}
        >
          <CaretLeftIcon aria-hidden="true" />
        </Button>
        <input
          type="range"
          className="replay-range"
          min={0}
          max={store.total}
          value={store.step}
          aria-label={t("slider")}
          aria-valuetext={t("step", { step: store.step, total: store.total })}
          onChange={(event) => store.goTo(Number(event.target.value))}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("next")}
          disabled={store.atEnd}
          onClick={() => store.next()}
        >
          <CaretRightIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("last")}
          disabled={store.atEnd}
          onClick={() => store.last()}
        >
          <CaretDoubleRightIcon aria-hidden="true" />
        </Button>
      </div>
      {moves.length > 0 && (
        <ol ref={list} className="moves" aria-label={t("moves")}>
          {moves.map((move, index) => (
            <li key={move.n}>
              <button
                type="button"
                className="move"
                aria-current={step === index + 1 ? "step" : undefined}
                onClick={() => store.goTo(index + 1)}
                aria-label={`${t("moveNumber", { n: move.n })}: ${describe(move)}`}
              >
                <span className="move-n">{move.n}</span>
                <span className="move-name">{names[move.side]}</span>
                <span className="mono">
                  {move.x === null || move.y === null
                    ? "—"
                    : coordinate(move.x, move.y)}
                </span>
                <span className="move-outcome" data-outcome={move.outcome}>
                  {outcome(move)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});
