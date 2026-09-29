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

/** A ship drawn along its length (bow to the right); the board turns it for vertical. */
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
        fill={silver ? "url(#bs-hull-silver)" : "url(#bs-hull-classic)"}
      />
      <path
        className="ship-deck"
        d={deck(w)}
        fill={silver ? "url(#bs-deck-silver)" : "var(--ship-deck)"}
      />
      <path
        className="ship-keel"
        d={`M26 50 H${w - 44}`}
        stroke={silver ? "var(--ship-silver-dark)" : "var(--ship-detail)"}
        strokeWidth="1.5"
        strokeDasharray="5 6"
        opacity="0.45"
      />
      {parts.map((part) => {
        const cx = Math.round(part.at * w);
        const fill = silver ? "var(--ship-silver-dark)" : "var(--ship-detail)";
        if (part.kind === "turret") {
          return (
            <g key={`${part.kind}-${cx}`}>
              <path
                d={`M${cx} 50 H${cx + 17}`}
                stroke={fill}
                strokeWidth="3.4"
                strokeLinecap="round"
              />
              <circle cx={cx} cy="50" r="8" fill={fill} />
              <circle
                cx={cx - 1.5}
                cy="48"
                r="3"
                fill={silver ? "var(--ship-silver-light)" : "var(--ship-shine)"}
                opacity="0.55"
              />
            </g>
          );
        }
        if (part.kind === "bridge") {
          return (
            <g key={`${part.kind}-${cx}`}>
              <rect
                x={cx - 15}
                y="40"
                width="30"
                height="20"
                rx="5"
                fill={silver ? "var(--ship-silver-mid)" : "var(--ship-hull)"}
                stroke={fill}
                strokeWidth="1.5"
              />
              <rect
                x={cx - 9}
                y="44"
                width="18"
                height="4"
                rx="2"
                fill={silver ? "var(--ship-silver-light)" : "var(--ship-shine)"}
                opacity="0.7"
              />
              <path
                d={`M${cx + 15} 50 H${cx + 22}`}
                stroke={fill}
                strokeWidth="2"
                strokeLinecap="round"
              />
            </g>
          );
        }
        return (
          <g key={`${part.kind}-${cx}`}>
            <rect
              x={cx - 12}
              y="42"
              width="24"
              height="16"
              rx="8"
              fill={silver ? "var(--ship-silver-mid)" : "var(--ship-hull)"}
              stroke={fill}
              strokeWidth="1.5"
            />
            <path
              d={`M${cx + 4} 50 H${cx + 20}`}
              stroke={fill}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        );
      })}
      <path
        className="ship-shine"
        d={`M19 25.5 H${w - 42}`}
        stroke={silver ? "var(--ship-silver-light)" : "var(--ship-shine)"}
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity={silver ? 0.95 : 0.5}
      />
      <path
        className="ship-outline"
        d={hull(w)}
        fill="none"
        stroke="var(--ship-outline)"
        strokeWidth="1.4"
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
