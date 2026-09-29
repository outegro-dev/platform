"use client";

import type { PointerEvent, RefObject } from "react";
import { useRef } from "react";
import type { PlacementStore } from "@/game/stores/placement-store";

type Press = {
  id: number;
  grab: number;
  pointerId: number;
  x: number;
  y: number;
};

/**
 * Drag and drop for ships, from the tray or the board, with mouse, pen or
 * touch. A press becomes a drag after 6 px; until then it is a tap and the
 * click handler decides. The ghost follows the pointer through the
 * `translate` property (no layout); the board preview snaps to cells.
 */
export function useShipDrag(
  store: PlacementStore,
  boardRef: RefObject<HTMLDivElement | null>,
) {
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<Press | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const swallowClick = useRef(false);

  const water = () =>
    boardRef.current?.querySelector<HTMLElement>(".board-water") ?? null;

  const cellSize = () => {
    const element = water();
    return element ? element.getBoundingClientRect().width / 10 : 36;
  };

  const cellAt = (clientX: number, clientY: number) => {
    const element = water();
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const size = rect.width / 10;
    const x = Math.floor((clientX - rect.left) / size);
    const y = Math.floor((clientY - rect.top) / size);
    return x >= 0 && x < 10 && y >= 0 && y < 10 ? { x, y } : null;
  };

  const positionGhost = () => {
    const ghost = ghostRef.current;
    const drag = store.drag;
    if (!ghost || !drag) return;
    const size = cellSize();
    const vertical = store.orientation === "vertical";
    const offsetX = vertical ? size / 2 : drag.grab * size + size / 2;
    const offsetY = vertical ? drag.grab * size + size / 2 : size / 2;
    ghost.style.setProperty("--ghost-cell", `${size}px`);
    ghost.style.translate = `${last.current.x - offsetX}px ${last.current.y - offsetY}px`;
  };

  const bind = (
    id: number,
    grab: number | ((event: PointerEvent<HTMLElement>) => number),
  ) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || store.submitted) return;
      press.current = {
        id,
        grab: typeof grab === "function" ? grab(event) : grab,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      last.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      if (!current || current.pointerId !== event.pointerId) return;
      last.current = { x: event.clientX, y: event.clientY };
      if (!store.drag) {
        if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
        )
          return;
        store.beginDrag(current.id, current.grab);
      }
      positionGhost();
      store.setPointer(cellAt(event.clientX, event.clientY));
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      press.current = null;
      if (!current || !store.drag) return;
      swallowClick.current = true;
      store.endDrag(cellAt(event.clientX, event.clientY));
    },
    onPointerCancel() {
      press.current = null;
      if (store.drag) store.cancelDrag();
    },
  });

  /** True once after a drag: the click that follows must not act. */
  const consumeClick = () => {
    if (!swallowClick.current) return false;
    swallowClick.current = false;
    return true;
  };

  return { ghostRef, bind, consumeClick, positionGhost };
}

export type ShipDrag = ReturnType<typeof useShipDrag>;
