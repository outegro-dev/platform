"use client";

import { autorun } from "mobx";
import { observer } from "mobx-react-lite";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { DemoLoop } from "@/game/demo/demo-loop";
import type { Effect } from "@/game/stores/match-store";
import { useRoot } from "../providers";
import { BoardFrame, type BoardTheme, gridOf } from "./board-frame";
import { CellMark, EffectView, type HitEffect } from "./marks";
import { BoardShip, type ShipSkin } from "./ship";

/** The player's shots fly in from below the board, as in a match. */
const FROM_BELOW = { x: 4.5, y: 12 };

/**
 * The home page board, alive: a short battle plays on a loop (the sight
 * moves, a shell flies, water splashes or fire flares, a destroyer is found
 * and sunk, the fleet surfaces) and starts over. One timer per beat moves
 * it on; CSS animates only transform and opacity. With reduced motion it
 * rests on the still picture (the server render); off screen or in a
 * hidden tab it pauses. Screen readers get one labelled image.
 */
export const LiveDemoBoard = observer(function LiveDemoBoard({
  label,
  theme = "day",
  skin = "silver",
  effect = "flame",
}: {
  label: string;
  theme?: BoardTheme;
  skin?: ShipSkin;
  effect?: HitEffect;
}) {
  const { preferences } = useRoot();
  const [loop] = useState(() => new DemoLoop());
  const [cells] = useState(() => gridOf(() => <span className="cell" />));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loop.start();
    const stop = autorun(() => {
      loop.setMotion(!preferences.reducedMotion);
      loop.setPageVisible(!preferences.hidden);
    });
    const node = ref.current;
    let watcher: IntersectionObserver | null = null;
    if (node && typeof IntersectionObserver === "function") {
      watcher = new IntersectionObserver((entries) => {
        const last = entries.at(-1);
        if (last) loop.setOnScreen(last.isIntersecting);
      });
      watcher.observe(node);
    } else {
      loop.setOnScreen(true);
    }
    return () => {
      stop();
      watcher?.disconnect();
      loop.dispose();
    };
  }, [loop, preferences]);

  const frame = loop.frame;
  const shot: Effect | null = frame.effect
    ? { id: loop.beat, board: "target", ...frame.effect }
    : null;

  return (
    <div
      ref={ref}
      className="demo-live"
      role="img"
      aria-label={label}
      data-testid="demo-board"
      data-phase={frame.phase}
      data-beat={loop.beat}
      data-playing={loop.playing || undefined}
      data-paused={loop.paused || undefined}
      data-aim={frame.aiming || undefined}
      style={
        frame.aim
          ? ({
              "--aim-x": frame.aim.x,
              "--aim-y": frame.aim.y,
            } as CSSProperties)
          : undefined
      }
    >
      <div aria-hidden="true">
        <BoardFrame
          label={label}
          theme={theme}
          cells={cells}
          ships={
            <>
              <span className="aim-line" data-axis="x" />
              <span className="aim-line" data-axis="y" />
              {frame.phase === "reset" ? (
                <span key={loop.round} className="demo-sonar" />
              ) : null}
              {frame.ships.map(({ ship, shown, wreck, sinking }) => (
                <span
                  key={`${ship.x}-${ship.y}`}
                  className="demo-piece"
                  data-shown={shown || undefined}
                  data-wreck={wreck || undefined}
                >
                  <BoardShip
                    {...ship}
                    skin={skin}
                    state={wreck ? "wreck" : "idle"}
                    sinking={sinking}
                  />
                </span>
              ))}
              <span className="demo-marks">
                {frame.marks.map((mark) => (
                  <span
                    key={`${mark.x}-${mark.y}`}
                    className="demo-mark"
                    style={
                      mark.delay
                        ? ({ "--delay": `${mark.delay}ms` } as CSSProperties)
                        : undefined
                    }
                  >
                    <CellMark
                      x={mark.x}
                      y={mark.y}
                      kind={mark.kind}
                      effect={effect}
                    />
                  </span>
                ))}
              </span>
              <span className="aim-reticle" />
            </>
          }
          fx={
            shot ? (
              <EffectView
                key={`${loop.round}-${loop.beat}`}
                effect={shot}
                hitEffect={effect}
                from={FROM_BELOW}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
});
