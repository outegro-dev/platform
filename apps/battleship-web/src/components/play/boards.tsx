"use client";

import { placementCells, type ShipPlacement } from "@outegro/battleship-engine";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useRef, useState } from "react";
import type { Effect } from "@/game/stores/match-store";
import { BoardFrame, cellName, gridOf } from "../board/board-frame";
import { CellMark, EffectView } from "../board/marks";
import { BoardShip } from "../board/ship";
import { useRoot } from "../providers";

const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

/** Shots at your waters come in from above, yours fly from below. */
const FROM_ABOVE = { x: 4.5, y: -2.5 };
const FROM_BELOW = { x: 4.5, y: 12 };

function sinkingKeys(effects: Effect[], board: Effect["board"]): Set<string> {
  const keys = new Set<string>();
  for (const effect of effects) {
    if (effect.board === board && effect.kind === "sunk") {
      keys.add(`${effect.x},${effect.y}`);
    }
  }
  return keys;
}

function covers(ship: ShipPlacement, keys: Set<string>): boolean {
  return placementCells(ship).some((cell) => keys.has(cell.key));
}

/** Ships still afloat as small pips (sunk ones dimmed). */
export function FleetPips({
  afloat,
  label,
}: {
  afloat: number[];
  label: string;
}) {
  const left = [...afloat];
  const pips = FLEET.map((length) => {
    const index = left.indexOf(length);
    if (index >= 0) left.splice(index, 1);
    return { length, gone: index < 0 };
  });
  return (
    <span className="fleet-pips" role="img" aria-label={label}>
      {pips.map((pip, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed fleet order
          key={i}
          className="fleet-pip"
          data-gone={pip.gone || undefined}
        >
          {Array.from({ length: pip.length }, (_, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: decorative squares
            <i key={j} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Your waters: your fleet, the shots you took, their effects. */
export const OwnBoard = observer(function OwnBoard({
  size = "lg",
}: {
  size?: "lg" | "sm";
}) {
  const { match, session } = useRoot();
  const t = useTranslations("battle");
  const { ships: skin, hitEffect, theme } = session.cosmetics;
  const sinking = sinkingKeys(match.effects, "own");
  const occupied = new Set(
    match.ownShips.flatMap((ship) =>
      placementCells(ship).map((cell) => cell.key),
    ),
  );
  return (
    <BoardFrame
      label={t("ownLabel")}
      theme={theme}
      size={size}
      testId="own-board"
      cells={gridOf((x, y) => {
        const shot = match.ownShots[y]?.[x] ?? "unknown";
        const ship = occupied.has(`${x},${y}`);
        const key =
          shot === "unknown"
            ? ship
              ? "ship"
              : "water"
            : shot === "miss"
              ? "miss"
              : shot;
        return (
          <span className="cell">
            <span className="sr-only">
              {t(`ownCell.${key}`, { cell: cellName(x, y) })}
            </span>
          </span>
        );
      })}
      ships={
        <>
          {match.ownShips.map((ship) => (
            <BoardShip
              key={`${ship.x}-${ship.y}-${ship.orientation}`}
              x={ship.x}
              y={ship.y}
              length={ship.length}
              orientation={ship.orientation}
              skin={skin}
              state={ship.sunk ? "wreck" : "idle"}
              sinking={ship.sunk && covers(ship, sinking)}
            />
          ))}
          {match.ownShots.flatMap((row, y) =>
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
        </>
      }
      fx={match.effects
        .filter((effect) => effect.board === "own")
        .map((effect) => (
          <EffectView
            key={effect.id}
            effect={effect}
            hitEffect={hitEffect}
            from={FROM_ABOVE}
          />
        ))}
    />
  );
});

/**
 * Enemy waters. In battle every cell is a button ("B7, unknown"): arrows
 * move, Enter or Space fires, hover and focus aim. After the match the
 * whole enemy fleet is revealed.
 */
export const TargetBoard = observer(function TargetBoard({
  interactive = true,
  size = "lg",
}: {
  interactive?: boolean;
  size?: "lg" | "sm";
}) {
  const { match, session } = useRoot();
  const t = useTranslations("battle");
  const boardRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState({ x: 4, y: 4 });
  const { ships: skin, hitEffect, theme } = session.cosmetics;
  const sinking = sinkingKeys(match.effects, "target");
  const sunkKeys = new Set(
    match.sunkShips.flatMap((ship) =>
      placementCells(ship).map((cell) => cell.key),
    ),
  );
  const revealed = (match.opponentFleet ?? []).filter(
    (ship) => !placementCells(ship).every((cell) => sunkKeys.has(cell.key)),
  );

  const aim = (x: number, y: number) => {
    const board = boardRef.current;
    if (!board) return;
    board.style.setProperty("--aim-x", String(x));
    board.style.setProperty("--aim-y", String(y));
    board.dataset.aim = "";
  };
  const clearAim = () => {
    if (boardRef.current) delete boardRef.current.dataset.aim;
  };
  const moveFocus = (x: number, y: number) => {
    const next = {
      x: Math.max(0, Math.min(9, x)),
      y: Math.max(0, Math.min(9, y)),
    };
    setFocus(next);
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-x="${next.x}"][data-y="${next.y}"]`)
      ?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      moveFocus(focus.x + move[0], focus.y + move[1]);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(0, focus.y);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(9, focus.y);
    }
  };

  return (
    <BoardFrame
      label={t("targetLabel")}
      theme={theme}
      size={size}
      interactive={interactive}
      active={interactive && match.isYourTurn}
      grid={interactive}
      boardRef={boardRef}
      testId="target-board"
      onKeyDown={interactive ? onKeyDown : undefined}
      onPointerLeave={clearAim}
      cells={gridOf((x, y) => {
        const state = match.targetCells[y]?.[x] ?? "unknown";
        const label = t(`cell.${state}`, { cell: cellName(x, y) });
        if (!interactive) {
          return (
            <span className="cell">
              <span className="sr-only">{label}</span>
            </span>
          );
        }
        const allowed = match.canTarget(x, y);
        return (
          <button
            type="button"
            className="cell"
            data-x={x}
            data-y={y}
            tabIndex={focus.x === x && focus.y === y ? 0 : -1}
            aria-label={label}
            aria-disabled={allowed ? undefined : true}
            onClick={() => {
              if (allowed) match.fire(x, y);
            }}
            onPointerEnter={() => aim(x, y)}
            onFocus={() => {
              setFocus({ x, y });
              aim(x, y);
            }}
            onBlur={clearAim}
          />
        );
      })}
      ships={
        <>
          {interactive ? (
            <>
              <span className="aim-line" data-axis="x" />
              <span className="aim-line" data-axis="y" />
            </>
          ) : null}
          {match.sunkShips.map((ship) => (
            <BoardShip
              key={`sunk-${ship.x}-${ship.y}-${ship.orientation}`}
              x={ship.x}
              y={ship.y}
              length={ship.length}
              orientation={ship.orientation}
              skin={skin}
              state="wreck"
              sinking={covers(ship, sinking)}
            />
          ))}
          {revealed.map((ship) => (
            <BoardShip
              key={`rev-${ship.x}-${ship.y}-${ship.orientation}`}
              x={ship.x}
              y={ship.y}
              length={ship.length}
              orientation={ship.orientation}
              skin={skin}
              state="ghost"
            />
          ))}
          {match.targetCells.flatMap((row, y) =>
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
          {interactive ? <span className="aim-reticle" /> : null}
        </>
      }
      fx={match.effects
        .filter((effect) => effect.board === "target")
        .map((effect) => (
          <EffectView
            key={effect.id}
            effect={effect}
            hitEffect={hitEffect}
            from={FROM_BELOW}
          />
        ))}
    />
  );
});
