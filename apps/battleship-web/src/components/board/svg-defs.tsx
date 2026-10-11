/**
 * Paint shared by every ship on the page (referenced as url(#bs-…)): the
 * engraving on foil card and the scribble over a sunk ship. Colours are
 * design tokens, resolved here at the page level; the SVG itself has no
 * size.
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
        <pattern
          id="bs-engrave"
          patternUnits="userSpaceOnUse"
          width="7"
          height="7"
          patternTransform="rotate(-32)"
        >
          <path
            d="M0 3.5 H7"
            style={{ stroke: "var(--ship-engrave)", strokeWidth: 1.2 }}
          />
        </pattern>
        <pattern
          id="bs-scribble"
          patternUnits="userSpaceOnUse"
          width="12"
          height="12"
          patternTransform="rotate(38)"
        >
          <path
            d="M0 6 H12"
            style={{ stroke: "var(--ship-scribble)", strokeWidth: 3 }}
          />
        </pattern>
      </defs>
    </svg>
  );
}
