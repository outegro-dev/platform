/**
 * Gradients shared by every ship and effect on the page (referenced as
 * url(#bs-…)). Colours are design tokens; the SVG itself has no size.
 */
export function GameSvgDefs() {
  return (
    <svg
      className="svg-defs"
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
    >
      <defs>
        <linearGradient id="bs-hull-classic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ship-detail)" }} />
          <stop offset="0.18" style={{ stopColor: "var(--ship-deck)" }} />
          <stop offset="0.62" style={{ stopColor: "var(--ship-hull)" }} />
          <stop offset="1" style={{ stopColor: "var(--ship-outline)" }} />
        </linearGradient>
        <linearGradient id="bs-hull-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ship-silver-dark)" }} />
          <stop
            offset="0.22"
            style={{ stopColor: "var(--ship-silver-light)" }}
          />
          <stop offset="0.4" style={{ stopColor: "var(--ship-silver-mid)" }} />
          <stop
            offset="0.58"
            style={{ stopColor: "var(--ship-silver-light)" }}
          />
          <stop offset="0.8" style={{ stopColor: "var(--ship-silver-dark)" }} />
          <stop offset="1" style={{ stopColor: "var(--ship-silver-mid)" }} />
        </linearGradient>
        <linearGradient id="bs-deck-silver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ship-silver-light)" }} />
          <stop offset="1" style={{ stopColor: "var(--ship-silver-mid)" }} />
        </linearGradient>
        <linearGradient id="bs-flame" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: "var(--flame-edge)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--flame-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--flame-core)" }} />
        </linearGradient>
        <linearGradient id="bs-shard" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--shard-light)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--shard-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--shard-dark)" }} />
        </linearGradient>
        <radialGradient id="bs-flash" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" style={{ stopColor: "var(--spark-white)" }} />
          <stop offset="0.35" style={{ stopColor: "var(--flame-core)" }} />
          <stop
            offset="1"
            style={{ stopColor: "var(--flame-mid)", stopOpacity: 0 }}
          />
        </radialGradient>
      </defs>
    </svg>
  );
}
