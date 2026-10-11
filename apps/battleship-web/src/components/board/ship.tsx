import type { CSSProperties } from "react";

export type ShipSkin = "classic" | "silver";
export type ShipState = "idle" | "ghost" | "invalid" | "wreck" | "lifted";

type Part = { kind: "turret" | "bridge" | "tower"; at: number };

/** Superstructure per ship length, as a share of the hull length. */
const layouts: Record<number, Part[]> = {
  1: [{ kind: "tower", at: 0.44 }],
  2: [
    { kind: "bridge", at: 0.36 },
    { kind: "turret", at: 0.7 },
  ],
  3: [
    { kind: "turret", at: 0.2 },
    { kind: "bridge", at: 0.47 },
    { kind: "turret", at: 0.74 },
  ],
  4: [
    { kind: "turret", at: 0.14 },
    { kind: "turret", at: 0.29 },
    { kind: "bridge", at: 0.5 },
    { kind: "turret", at: 0.76 },
  ],
};

const hull = (w: number) =>
  `M15 22 H${w - 38} C${w - 18} 22 ${w - 7} 38 ${w - 3} 50 C${w - 7} 62 ${w - 18} 78 ${w - 38} 78 H15 C9 78 5 74 5 68 V32 C5 26 9 22 15 22 Z`;
const deck = (w: number) =>
  `M20 31 H${w - 41} C${w - 27} 31 ${w - 17} 41 ${w - 13} 50 C${w - 17} 59 ${w - 27} 69 ${w - 41} 69 H20 C16.5 69 14 66.5 14 63 V37 C14 33.5 16.5 31 20 31 Z`;

/**
 * A ship drawn along its length (bow to the right); the board turns it for
 * vertical. A paper cut-out: a flat card hull with an ink outline, a dashed
 * fold line, superstructure glued on in paper-white. The silver skin is cut
 * from foil card, engraved with fine hatching. A sunk ship is scribbled over
 * (shown by the board for wrecks). Strokes keep their width at any size.
 */
export function ShipArt({ length, skin }: { length: number; skin: ShipSkin }) {
  const w = length * 100;
  const parts = layouts[length] ?? layouts[1] ?? [];
  const silver = skin === "silver";
  return (
    <svg
      className="ship-art"
      viewBox={`0 0 ${w} 100`}
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="ship-hull"
        d={hull(w)}
        fill={silver ? "var(--ship-silver-mid)" : "var(--ship-hull)"}
      />
      <path
        className="ship-deck"
        d={deck(w)}
        fill={silver ? "var(--ship-silver-light)" : "var(--ship-deck)"}
      />
      {silver ? (
        <path className="ship-engrave" d={hull(w)} fill="url(#bs-engrave)" />
      ) : null}
      <path
        className="ship-fold"
        d={`M26 50 H${w - 44}`}
        stroke="var(--ship-fold)"
        strokeWidth="1.25"
        strokeDasharray="3 4"
      />
      {parts.map((part) => {
        const cx = Math.round(part.at * w);
        if (part.kind === "turret") {
          return (
            <g key={`${part.kind}-${cx}`}>
              <path
                d={`M${cx} 50 H${cx + 19}`}
                stroke="var(--ship-outline)"
                strokeWidth="2.25"
                strokeLinecap="round"
              />
              <circle
                cx={cx}
                cy="50"
                r="8.5"
                fill="var(--ship-detail)"
                stroke="var(--ship-outline)"
                strokeWidth="1.25"
              />
            </g>
          );
        }
        if (part.kind === "bridge") {
          return (
            <g key={`${part.kind}-${cx}`}>
              <rect
                x={cx - 15}
                y="39"
                width="30"
                height="22"
                rx="2"
                fill="var(--ship-detail)"
                stroke="var(--ship-outline)"
                strokeWidth="1.25"
              />
              <path
                d={`M${cx - 9} 46 H${cx + 9}`}
                stroke="var(--ship-outline)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d={`M${cx + 15} 50 H${cx + 23}`}
                stroke="var(--ship-outline)"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </g>
          );
        }
        return (
          <g key={`${part.kind}-${cx}`}>
            <rect
              x={cx - 12}
              y="41"
              width="24"
              height="18"
              rx="9"
              fill="var(--ship-detail)"
              stroke="var(--ship-outline)"
              strokeWidth="1.25"
            />
            <path
              d={`M${cx + 4} 50 H${cx + 21}`}
              stroke="var(--ship-outline)"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      <path className="ship-scribble" d={hull(w)} fill="url(#bs-scribble)" />
      <path
        className="ship-outline"
        d={hull(w)}
        fill="none"
        stroke="var(--ship-outline)"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
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

/** A ship positioned on a board layer (cells from the top-left of the water). */
export function BoardShip({
  x,
  y,
  length,
  orientation,
  skin,
  state = "idle",
  sinking = false,
}: {
  x: number;
  y: number;
  length: number;
  orientation: "horizontal" | "vertical";
  skin: ShipSkin;
  state?: ShipState;
  sinking?: boolean;
}) {
  return (
    <div
      className="ship"
      data-orientation={orientation}
      data-skin={skin}
      data-state={state}
      data-sinking={sinking || undefined}
      style={{ "--x": x, "--y": y, "--len": length } as CSSProperties}
    >
      <ShipArt length={length} skin={skin} />
    </div>
  );
}
