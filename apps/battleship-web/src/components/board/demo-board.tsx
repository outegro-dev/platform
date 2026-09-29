import { demoFrame } from "@/game/demo/demo-script";
import { BoardFrame, type BoardTheme, gridOf } from "./board-frame";
import { CellMark, type HitEffect } from "./marks";
import { BoardShip, type ShipSkin } from "./ship";

/**
 * A still frame of a battle (static): the shop previews use it to show
 * skins and themes. It is the last frame of the home page's live battle
 * (LiveDemoBoard), drawn from the same script.
 */
export function DemoBoard({
  label,
  theme = "day",
  skin = "classic",
  effect = "flame",
  size = "lg",
}: {
  label: string;
  theme?: BoardTheme;
  skin?: ShipSkin;
  effect?: HitEffect;
  size?: "lg" | "sm" | "xs";
}) {
  const frame = demoFrame(0);
  return (
    <BoardFrame
      label={label}
      theme={theme}
      size={size}
      cells={gridOf(() => <span className="cell" />)}
      ships={
        <>
          {frame.ships.map(({ ship, wreck }) => (
            <BoardShip
              key={`${ship.x}-${ship.y}`}
              {...ship}
              skin={skin}
              state={wreck ? "wreck" : "idle"}
            />
          ))}
          {frame.marks.map((mark) => (
            <CellMark
              key={`${mark.x}-${mark.y}`}
              x={mark.x}
              y={mark.y}
              kind={mark.kind}
              effect={effect}
            />
          ))}
        </>
      }
    />
  );
}
