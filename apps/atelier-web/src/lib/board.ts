import {
  type ApplicationCard,
  type ApplicationFlag,
  type ApplicationStage,
  type ArchiveReason,
  applicationFlagSchema,
  applicationStages,
  type Board,
} from "@outegro/contracts/atelier";

/*
 * The board's rules without React: filters, the order of columns and an
 * optimistic move, so the view stays thin and these are tested on their own.
 */

export type BoardFilters = {
  q: string;
  source: string;
  flag: ApplicationFlag | "";
};

export const emptyFilters: BoardFilters = { q: "", source: "", flag: "" };

/** Filters from the address bar (?q=&source=&flag=); anything unknown is dropped. */
export function parseFilters(params: URLSearchParams): BoardFilters {
  const flag = applicationFlagSchema.safeParse(params.get("flag"));
  return {
    q: (params.get("q") ?? "").slice(0, 120),
    source: (params.get("source") ?? "").slice(0, 60),
    flag: flag.success ? flag.data : "",
  };
}

/** The query string for filters, empty values left out. */
export function filtersQuery(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.source) params.set("source", filters.source);
  if (filters.flag) params.set("flag", filters.flag);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const isFiltered = (filters: BoardFilters) =>
  Boolean(filters.q.trim() || filters.source || filters.flag);

/** Case- and accent-insensitive text for search. */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** A card passes when every word of the search is in its company, role or location. */
export function matches(card: ApplicationCard, filters: BoardFilters): boolean {
  if (filters.source && card.source !== filters.source) return false;
  if (filters.flag && !card.flags.includes(filters.flag)) return false;
  const words = fold(filters.q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = fold(
    [card.company, card.role, card.location ?? ""].join(" "),
  );
  return words.every((word) => haystack.includes(word));
}

export type Column = { stage: ApplicationStage; items: ApplicationCard[] };

/** Every stage once, in the funnel's order, whatever the backend sent. */
export function columnsOf(board: Board): Column[] {
  return applicationStages.map((stage) => ({
    stage,
    items: board.columns
      .filter((column) => column.stage === stage)
      .flatMap((column) => column.items),
  }));
}

/** Sources on the board, most cards first (for the source filter). */
export function sourcesOf(board: Board): string[] {
  const counts = new Map<string, number>();
  for (const column of board.columns)
    for (const card of column.items)
      counts.set(card.source, (counts.get(card.source) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source]) => source);
}

export type Move = {
  id: string;
  stage: ApplicationStage;
  archiveReason?: ArchiveReason;
};

/** The board after a move, before the server confirms it: the card on top of its new column. */
export function applyMove(board: Board, move: Move): Board {
  let moved: ApplicationCard | undefined;
  const columns = board.columns.map((column) => {
    const items = column.items.filter((card) => {
      if (card.id !== move.id) return true;
      moved = card;
      return false;
    });
    return { ...column, items };
  });
  if (!moved) return board;
  const card: ApplicationCard = {
    ...moved,
    stage: move.stage,
    archiveReason:
      move.stage === "archived" ? (move.archiveReason ?? null) : null,
  };
  const target = columns.find((column) => column.stage === move.stage);
  if (target) target.items = [card, ...target.items];
  else columns.push({ stage: move.stage, items: [card] });
  return { ...board, columns };
}

/** The card with this id, wherever it is. */
export function findCard(board: Board, id: string): ApplicationCard | null {
  for (const column of board.columns)
    for (const card of column.items) if (card.id === id) return card;
  return null;
}

/** Share of sent applications that got a reply, or null before the first one. */
export function replyRate(stats: Board["stats"]): number | null {
  return stats.sent > 0 ? Math.min(1, stats.replies / stats.sent) : null;
}
