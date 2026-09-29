"use client";

import { Button } from "@outegro/ui/button";
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  EraserIcon,
  ShuffleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { ShipSlot } from "@/game/stores/placement-store";
import { BoardFrame, cellName, gridOf } from "../board/board-frame";
import { BoardLegend, SelectedFrame } from "../board/board-legend";
import { BoardShip, ShipArt } from "../board/ship";
import { StableLabel } from "../home/modes";
import { useRoot } from "../providers";
import { CountdownRing } from "./countdown-ring";
import { OpponentChip } from "./match-bar";
import { type ShipDrag, useShipDrag } from "./use-ship-drag";

const at = (x: number, y: number) => ({ "--x": x, "--y": y }) as CSSProperties;

function grabIndex(slot: ShipSlot, x: number, y: number): number {
  const placement = slot.placement;
  if (!placement) return 0;
  return placement.orientation === "horizontal"
    ? x - placement.x
    : y - placement.y;
}

const PlacementBoard = observer(function PlacementBoard({
  boardRef,
  drag,
}: {
  boardRef: RefObject<HTMLDivElement | null>;
  drag: ShipDrag;
}) {
  const { placement: store, session } = useRoot();
  const t = useTranslations("placement");
  const { ships: skin, theme } = session.cosmetics;
  const preview = store.preview;
  const cursor = store.cursor;
  const picked = store.submitted ? null : (store.selected?.placement ?? null);

  const focusCell = (x: number, y: number) =>
    boardRef.current
      ?.querySelector<HTMLElement>(`[data-x="${x}"][data-y="${y}"]`)
      ?.focus();

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
      store.moveCursor(move[0], move[1]);
      focusCell(store.cursor.x, store.cursor.y);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      store.removeAt(cursor.x, cursor.y);
    } else if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      store.selectLength(Number(event.key));
    } else if (event.key === "Escape") {
      store.select(null);
    }
  };

  return (
    <BoardFrame
      label={t("boardLabel")}
      theme={theme}
      interactive={!store.submitted}
      grid
      boardRef={boardRef}
      testId="placement-board"
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        if (!store.drag) store.setPointer(null);
      }}
      cells={gridOf((x, y) => {
        const slot = store.slotAt(x, y);
        const name = cellName(x, y);
        const handlers =
          slot && !store.submitted
            ? drag.bind(slot.id, grabIndex(slot, x, y))
            : {};
        return (
          <button
            type="button"
            className="cell"
            data-x={x}
            data-y={y}
            data-draggable={slot && !store.submitted ? "" : undefined}
            tabIndex={cursor.x === x && cursor.y === y ? 0 : -1}
            aria-label={
              slot
                ? t("cell.ship", { cell: name, length: slot.length })
                : t("cell.empty", { cell: name })
            }
            aria-disabled={store.submitted || undefined}
            {...handlers}
            onClick={() => {
              if (drag.consumeClick() || store.submitted) return;
              store.activateCell(x, y);
            }}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse" && !store.drag)
                store.setPointer({ x, y });
            }}
            onFocus={() => {
              store.setCursor({ x, y });
              store.setCursorActive(true);
            }}
            onBlur={() => store.setCursorActive(false)}
          />
        );
      })}
      ships={
        <>
          {store.placed.map((slot) =>
            slot.placement ? (
              <BoardShip
                key={slot.id}
                x={slot.placement.x}
                y={slot.placement.y}
                length={slot.length}
                orientation={slot.placement.orientation}
                skin={skin}
                state={store.drag?.id === slot.id ? "lifted" : "idle"}
              />
            ) : null,
          )}
          {picked ? (
            <SelectedFrame
              x={picked.x}
              y={picked.y}
              length={picked.length}
              orientation={picked.orientation}
            />
          ) : null}
          {preview
            ? preview.cells.map((cell) => (
                <span
                  key={`p-${cell.x}-${cell.y}`}
                  className="preview-cell"
                  data-bad={preview.issue ? "" : undefined}
                  style={at(cell.x, cell.y)}
                />
              ))
            : null}
          {preview ? (
            <BoardShip
              x={preview.placement.x}
              y={preview.placement.y}
              length={preview.placement.length}
              orientation={preview.placement.orientation}
              skin={skin}
              state={preview.issue ? "invalid" : "ghost"}
            />
          ) : null}
          {store.cursorActive && !preview && !store.submitted ? (
            <span className="cursor-cell" style={at(cursor.x, cursor.y)} />
          ) : null}
        </>
      }
    />
  );
});

const FleetTray = observer(function FleetTray({ drag }: { drag: ShipDrag }) {
  const { placement: store, session } = useRoot();
  const t = useTranslations("placement");
  const rows = [4, 3, 2, 1].map((length) =>
    store.slots.filter((slot) => slot.length === length),
  );
  return (
    <div className="tray" data-testid="fleet-tray">
      {rows.map((slots) => (
        <div key={slots[0]?.length} className="tray-row">
          {slots.map((slot) => (
            <button
              key={slot.id}
              type="button"
              className="tray-ship"
              data-testid={`tray-ship-${slot.id}`}
              data-placed={slot.placement ? "" : undefined}
              aria-pressed={store.selectedId === slot.id}
              aria-label={
                slot.placement
                  ? t("cell.ship", {
                      cell: cellName(slot.placement.x, slot.placement.y),
                      length: slot.length,
                    })
                  : t("shipInTray", { length: slot.length })
              }
              disabled={store.submitted}
              style={{ "--len": slot.length } as CSSProperties}
              {...drag.bind(slot.id, (event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const cell = (rect.width - 12) / slot.length;
                return Math.min(
                  slot.length - 1,
                  Math.max(
                    0,
                    Math.floor((event.clientX - rect.left - 6) / cell),
                  ),
                );
              })}
              onClick={() => {
                if (drag.consumeClick()) return;
                store.select(slot.id);
              }}
            >
              <ShipArt length={slot.length} skin={session.cosmetics.ships} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
});

const DragGhost = observer(function DragGhost({ drag }: { drag: ShipDrag }) {
  const { placement: store, session } = useRoot();
  const slot = store.drag
    ? store.slots.find((item) => item.id === store.drag?.id)
    : null;
  useLayoutEffect(() => {
    if (slot) drag.positionGhost();
  });
  if (!slot) return null;
  return (
    <div
      ref={drag.ghostRef}
      className="drag-ghost"
      data-orientation={store.orientation}
      style={{ "--len": slot.length } as CSSProperties}
      aria-hidden="true"
    >
      <ShipArt length={slot.length} skin={session.cosmetics.ships} />
    </div>
  );
});

const PlacementStatus = observer(function PlacementStatus() {
  const { placement: store } = useRoot();
  const t = useTranslations("placement");
  const o = useTranslations("placement.orientation");
  const serverIssue =
    store.serverError === "touching" ||
    store.serverError === "overlap" ||
    store.serverError === "out_of_bounds"
      ? store.serverError
      : null;
  const issue = store.issue ?? serverIssue;
  const placed = store.lastPlaced;
  return (
    <p
      className="status-line"
      role="status"
      data-tone={issue || store.serverError ? "error" : undefined}
      data-testid="placement-status"
    >
      {issue ? (
        <>
          <WarningCircleIcon aria-hidden="true" />
          {t(`issues.${issue}`)}
        </>
      ) : store.serverError ? (
        <>
          <WarningCircleIcon aria-hidden="true" />
          {t("placeAll")}
        </>
      ) : store.complete ? (
        <>
          <CheckCircleIcon aria-hidden="true" />
          {t("trayDone")}
        </>
      ) : placed ? (
        t("placed", {
          length: placed.length,
          cell: cellName(placed.x, placed.y),
          orientation: o(placed.orientation),
        })
      ) : (
        t("placeAll")
      )}
    </p>
  );
});

const OpponentStatus = observer(function OpponentStatus() {
  const { match, placement: store } = useRoot();
  const t = useTranslations("placement");
  const b = useTranslations("battle");
  const ready = match.opponentFleetPlaced;
  const ms = match.msLeft;
  const seconds = match.secondsLeft;
  return (
    <div className="placement-meta">
      <div
        className="opponent-status"
        data-ready={ready || undefined}
        role="status"
        data-testid="opponent-status"
      >
        {ready ? (
          <CheckCircleIcon weight="fill" aria-hidden="true" />
        ) : (
          <span className="spinner" aria-hidden="true" />
        )}
        {ready ? t("opponentReady") : t("opponentPlacing")}
      </div>
      {ms !== null && seconds !== null && match.deadline ? (
        <div className="placement-timer">
          <CountdownRing
            key={match.deadline}
            msLeft={ms}
            totalMs={match.clockTotalMs}
            seconds={seconds}
            unit={b("secondsUnit")}
            label={`${t("timeLeft")}: ${b("seconds", { seconds })}`}
          />
          <span className="placement-timer-text">
            <span className="small">{t("timeLeft")}</span>
            <span className="small muted" data-testid="placement-rule">
              {store.submitted ? t("timeRuleReady") : t("timeRule")}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
});

export const PlacementScreen = observer(function PlacementScreen() {
  const { placement: store } = useRoot();
  const t = useTranslations("placement");
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useShipDrag(store, boardRef);

  // R rotates from anywhere on the screen (not while typing).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        store.rotate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store]);

  const sending = store.pendingSubmit;
  return (
    <section
      className="match"
      aria-labelledby="placement-title"
      data-testid="placement"
    >
      <div className="placement">
        <div className="board-column">
          <div className="placement-head">
            <h1 id="placement-title">{t("title")}</h1>
            <p className="muted">{t("hint")}</p>
          </div>
          <PlacementBoard boardRef={boardRef} drag={drag} />
          <p className="small muted">{t("keyboardHint")}</p>
          <BoardLegend mode="placement" />
        </div>
        <aside className="card placement-side" aria-label={t("tray")}>
          <OpponentChip />
          <OpponentStatus />
          <h2>{t("tray")}</h2>
          <FleetTray drag={drag} />
          <div className="tool-row">
            <Button
              variant="outline"
              size="sm"
              onClick={store.rotate}
              disabled={store.submitted}
              aria-keyshortcuts="R"
            >
              <ArrowsClockwiseIcon />
              {t("rotate")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={store.randomize}
              disabled={store.submitted}
              data-testid="random-fleet"
            >
              <ShuffleIcon />
              {t("random")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={store.clear}
              disabled={store.submitted || store.placed.length === 0}
            >
              <EraserIcon />
              {t("clear")}
            </Button>
          </div>
          <PlacementStatus />
          {store.submitted ? (
            <p
              className="ready-note"
              role="status"
              data-testid="fleet-deployed"
            >
              <span className="spinner" aria-hidden="true" />
              {t("waiting")}
            </p>
          ) : (
            <Button
              size="lg"
              onClick={store.submit}
              disabled={!store.canSubmit}
              data-testid="ready"
            >
              <StableLabel
                active={sending}
                on={t("sending")}
                off={t("ready")}
              />
            </Button>
          )}
        </aside>
      </div>
      <DragGhost drag={drag} />
    </section>
  );
});
