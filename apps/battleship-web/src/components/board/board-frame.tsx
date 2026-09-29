import type {
  KeyboardEventHandler,
  PointerEventHandler,
  ReactNode,
  Ref,
} from "react";

export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
const INDEX = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

export type BoardTheme = "day" | "night-sea";

/**
 * A 10×10 board: a real table (column letters, row numbers, 100 cells) over
 * the water, with a clipped layer for ships and marks and a free layer for
 * effects. Sizes follow the container width; cells stay square.
 */
export function BoardFrame({
  label,
  theme,
  size = "lg",
  interactive = false,
  active = false,
  grid = false,
  cells,
  ships,
  fx,
  boardRef,
  onKeyDown,
  onPointerLeave,
  testId,
}: {
  label: string;
  theme: BoardTheme;
  size?: "lg" | "sm" | "xs";
  interactive?: boolean;
  active?: boolean;
  /** ARIA grid semantics (arrow-key navigation inside). */
  grid?: boolean;
  /**
   * Cell contents, [y][x]. Built by the caller during its own render (see
   * gridOf): an observer must read its observables itself, not inside a
   * callback this component would run later, or MobX never tracks them.
   */
  cells: ReactNode[][];
  ships?: ReactNode;
  fx?: ReactNode;
  boardRef?: Ref<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTableElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  testId?: string;
}) {
  const night = theme === "night-sea";
  return (
    <div
      ref={boardRef}
      className="board"
      data-size={size}
      data-sea={night ? "night" : undefined}
      data-tone={night ? "dark" : undefined}
      data-interactive={interactive || undefined}
      data-active={active || undefined}
      data-testid={testId}
      onPointerLeave={onPointerLeave}
    >
      <div className="board-grid">
        <div className="board-water" aria-hidden="true" />
        <div className="board-layer" data-layer="ships" aria-hidden="true">
          {ships}
        </div>
        <table
          className="board-table"
          role={grid ? "grid" : undefined}
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          <colgroup>
            <col />
            {INDEX.map((x) => (
              <col key={x} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td className="board-corner" />
              {LETTERS.map((letter) => (
                <th key={letter} scope="col">
                  {letter}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INDEX.map((y) => (
              <tr key={y}>
                <th scope="row">{y + 1}</th>
                {INDEX.map((x) => (
                  <td key={x}>{cells[y]?.[x]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="board-layer" data-layer="fx" aria-hidden="true">
          {fx}
        </div>
      </div>
    </div>
  );
}

/** Builds the 10×10 cell contents right away, in the calling render. */
export function gridOf(
  cell: (x: number, y: number) => ReactNode,
): ReactNode[][] {
  return INDEX.map((y) => INDEX.map((x) => cell(x, y)));
}

/** "B7" for x = 1, y = 6. */
export function cellName(x: number, y: number): string {
  return `${LETTERS[x] ?? "?"}${y + 1}`;
}
