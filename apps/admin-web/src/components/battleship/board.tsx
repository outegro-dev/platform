import type { Board as BoardState } from "@/lib/board";

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

/**
 * A 10×10 board: ships, misses, hits and sunk ships, the latest shot
 * outlined. Presentational only (used by the server and by the replay);
 * assistive technology gets a summary, the move list carries the detail.
 */
export function Board({ board, label }: { board: BoardState; label: string }) {
  return (
    <div className="board" role="img" aria-label={label}>
      <span aria-hidden="true" />
      {COLUMNS.map((column) => (
        <span
          key={column}
          className="board-label"
          data-axis="top"
          aria-hidden="true"
        >
          {column}
        </span>
      ))}
      {board.map((row, y) => (
        <BoardRow key={row[0]?.id ?? "row"} row={row} y={y} />
      ))}
    </div>
  );
}

function BoardRow({ row, y }: { row: BoardState[number]; y: number }) {
  return (
    <>
      <span className="board-label" aria-hidden="true">
        {y + 1}
      </span>
      {row.map((cell) => (
        <span
          key={cell.id}
          className="cell"
          aria-hidden="true"
          data-ship={cell.ship ? "" : undefined}
          data-shot={cell.shot ?? undefined}
          data-last={cell.last ? "" : undefined}
        />
      ))}
    </>
  );
}
