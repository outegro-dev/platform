"use client";

import { CaretDownIcon, InfoIcon } from "@phosphor-icons/react";
import { observer } from "mobx-react-lite";
import { useTranslations } from "next-intl";
import { type CSSProperties, type ReactNode, useId, useState } from "react";
import { useRoot } from "../providers";
import { CellMark, ShotMarker } from "./marks";
import { BoardShip, type ShipState } from "./ship";

export type LegendMode = "placement" | "battle" | "result" | "replay";

type Item = { key: string; swatch: ReactNode; label: ReactNode };

/** A few cells of the same water, drawn with the board's own pieces. */
function Swatch({
  w,
  h = 1,
  night,
  children,
}: {
  w: number;
  h?: number;
  night: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className="legend-swatch"
      data-sea={night ? "night" : undefined}
      style={{ "--w": w, "--h": h } as CSSProperties}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}

/** The dashed frame around the ship picked on the placement board. */
export function SelectedFrame({
  x,
  y,
  length,
  orientation,
}: {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
}) {
  return (
    <span
      className="ship-selected"
      data-orientation={orientation}
      style={{ "--x": x, "--y": y, "--len": length } as CSSProperties}
    />
  );
}

/**
 * What every mark on the boards means, drawn with the same pieces in the
 * player's own skin, hit effect and sea, each with words (never colour
 * alone). A compact strip on wide screens; on phones one line that opens.
 */
export const BoardLegend = observer(function BoardLegend({
  mode,
}: {
  mode: LegendMode;
}) {
  const { session, placement } = useRoot();
  const t = useTranslations("legend");
  const o = useTranslations("placement.orientation");
  const [open, setOpen] = useState(false);
  const id = useId();
  const { ships: skin, hitEffect: effect, theme } = session.cosmetics;
  const night = theme === "night-sea";

  const swatch = (w: number, children: ReactNode, h = 1) => (
    <Swatch w={w} h={h} night={night}>
      {children}
    </Swatch>
  );
  const ship = (state: ShipState = "idle", x = 0, length = 2) => (
    <BoardShip
      x={x}
      y={0}
      length={length}
      orientation="horizontal"
      skin={skin}
      state={state}
    />
  );
  const mark = (x: number, kind: "miss" | "hit" | "sunk") => (
    <CellMark x={x} y={0} kind={kind} effect={effect} />
  );
  const preview = (bad: boolean) => (
    <>
      {[0, 1].map((x) => (
        <span
          key={x}
          className="preview-cell"
          data-bad={bad ? "" : undefined}
          style={{ "--x": x, "--y": 0 } as CSSProperties}
        />
      ))}
      {ship(bad ? "invalid" : "ghost")}
    </>
  );

  let items: Item[];
  if (mode === "placement") {
    const vertical = placement.orientation === "vertical";
    items = [
      { key: "placed", swatch: swatch(2, ship()), label: t("placed") },
      {
        key: "selected",
        swatch: swatch(
          2,
          <>
            {ship()}
            <SelectedFrame x={0} y={0} length={2} orientation="horizontal" />
          </>,
        ),
        label: t("selected"),
      },
      { key: "fits", swatch: swatch(2, preview(false)), label: t("fits") },
      { key: "blocked", swatch: swatch(2, preview(true)), label: t("blocked") },
      {
        key: "turn",
        swatch: swatch(
          2,
          <BoardShip
            x={vertical ? 0.5 : 0}
            y={vertical ? 0 : 0.5}
            length={2}
            orientation={placement.orientation}
            skin={skin}
          />,
          2,
        ),
        label: t.rich("turn", {
          orientation: o(placement.orientation),
          kbd: (chunks) => <kbd className="kbd">{chunks}</kbd>,
        }),
      },
    ];
  } else {
    const replay = mode === "replay";
    items = [
      {
        key: "ship",
        swatch: swatch(2, ship()),
        label: replay ? t("anyShip") : t("ship"),
      },
      {
        key: "ship-hit",
        swatch: swatch(
          2,
          <>
            {ship()}
            {mark(1, "hit")}
          </>,
        ),
        label: replay ? t("anyShipHit") : t("shipHit"),
      },
      { key: "miss", swatch: swatch(1, mark(0, "miss")), label: t("miss") },
      ...(replay
        ? []
        : [{ key: "hit", swatch: swatch(1, mark(0, "hit")), label: t("hit") }]),
      {
        key: "sunk",
        swatch: swatch(
          2,
          <>
            {ship("wreck")}
            {mark(0, "sunk")}
            {mark(1, "sunk")}
          </>,
        ),
        label: t("sunk"),
      },
      {
        key: "around",
        swatch: swatch(
          3,
          <>
            {mark(0, "miss")}
            {ship("wreck", 1, 1)}
            {mark(1, "sunk")}
            {mark(2, "miss")}
          </>,
        ),
        label: t("around"),
      },
      {
        key: "last",
        swatch: swatch(
          1,
          <>
            {mark(0, "miss")}
            <ShotMarker x={0} y={0} />
          </>,
        ),
        label: replay ? t("move") : t("last"),
      },
      ...(mode === "result"
        ? [
            {
              key: "afloat",
              swatch: swatch(2, ship("ghost")),
              label: t("afloat"),
            },
          ]
        : []),
    ];
  }

  return (
    <section
      className="legend"
      data-open={open || undefined}
      data-mode={mode}
      aria-labelledby={`${id}-title`}
      data-testid="board-legend"
    >
      <h2 className="legend-heading">
        <span className="legend-title" id={`${id}-title`}>
          {t("title")}
        </span>
        <button
          type="button"
          className="legend-toggle"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          onClick={() => setOpen((value) => !value)}
          data-testid="legend-toggle"
        >
          <InfoIcon aria-hidden="true" />
          {t("toggle")}
          <CaretDownIcon className="legend-caret" aria-hidden="true" />
        </button>
      </h2>
      <ul className="legend-list" id={`${id}-list`}>
        {items.map((item) => (
          <li key={item.key} className="legend-item" data-mark={item.key}>
            {item.swatch}
            <span className="legend-text">{item.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
});
