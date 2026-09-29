import { BoardFrame, type BoardTheme, gridOf } from "./board-frame";
import { CellMark, type HitEffect } from "./marks";
import { BoardShip, type ShipSkin } from "./ship";

type Ship = {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
};

const fleet: Ship[] = [
  { x: 1, y: 1, length: 4, orientation: "horizontal" },
  { x: 7, y: 0, length: 3, orientation: "vertical" },
  { x: 0, y: 4, length: 3, orientation: "vertical" },
  { x: 3, y: 4, length: 2, orientation: "horizontal" },
  { x: 7, y: 5, length: 2, orientation: "vertical" },
  { x: 2, y: 8, length: 2, orientation: "horizontal" },
  { x: 9, y: 9, length: 1, orientation: "horizontal" },
  { x: 5, y: 7, length: 1, orientation: "horizontal" },
  { x: 9, y: 3, length: 1, orientation: "horizontal" },
  { x: 5, y: 9, length: 1, orientation: "horizontal" },
];

const misses = [
  [5, 0],
  [3, 6],
  [8, 8],
  [0, 9],
  [6, 3],
];
const hits = [
  [2, 1],
  [3, 1],
  [7, 5],
];
/** The 2-deck at D5–E5 is sunk, with the water around it revealed. */
const sunk = { x: 3, y: 4, length: 2, orientation: "horizontal" } as const;

/**
 * A still frame of a battle (static, decorative): the home page hero and the
 * shop previews use it to show skins and themes.
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
  const around = [
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 3],
    [2, 5],
    [3, 5],
    [4, 5],
    [5, 5],
    [2, 4],
    [5, 4],
  ];
  return (
    <BoardFrame
      label={label}
      theme={theme}
      size={size}
      cells={gridOf(() => <span className="cell" />)}
      ships={
        <>
          {fleet
            .filter((ship) => !(ship.x === sunk.x && ship.y === sunk.y))
            .map((ship) => (
              <BoardShip key={`${ship.x}-${ship.y}`} {...ship} skin={skin} />
            ))}
          <BoardShip {...sunk} skin={skin} state="wreck" />
          {[...misses, ...around].map(([x = 0, y = 0]) => (
            <CellMark
              key={`m-${x}-${y}`}
              x={x}
              y={y}
              kind="miss"
              effect={effect}
            />
          ))}
          {hits.map(([x = 0, y = 0]) => (
            <CellMark
              key={`h-${x}-${y}`}
              x={x}
              y={y}
              kind="hit"
              effect={effect}
            />
          ))}
          <CellMark x={3} y={4} kind="sunk" effect={effect} />
          <CellMark x={4} y={4} kind="sunk" effect={effect} />
        </>
      }
    />
  );
}
