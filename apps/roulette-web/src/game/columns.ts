import type { OwnBet, RoundView } from "@outegro/contracts/roulette";

/** Lines a colour shows before "and N more". */
export const SHOWN_LINES = 7;

export type ColumnLine = {
  key: string;
  nickname: string;
  amount: number;
  /** The player's own bet: always shown and highlighted. */
  mine: boolean;
};

export type ColumnView = {
  lines: ColumnLine[];
  /** Bets not listed. */
  more: number;
  count: number;
  sum: number;
};

/**
 * One colour's list: the biggest bets from the server, with the player's
 * own bets always in it. A bet of yours outside the top seven takes the
 * place of the smallest listed one.
 */
export function columnView(
  totals: RoundView["totals"][keyof RoundView["totals"]],
  mine: OwnBet[],
  nickname: string,
): ColumnView {
  const ids = new Set(mine.map((bet) => bet.betId));
  const listed = new Set(totals.top.map((line) => line.betId));
  const extra = mine.filter((bet) => !listed.has(bet.betId));
  const top = totals.top.slice(0, Math.max(0, SHOWN_LINES - extra.length));
  const lines: ColumnLine[] = [
    ...top.map((line) => ({
      key: line.betId,
      nickname: line.nickname,
      amount: line.amount,
      mine: ids.has(line.betId),
    })),
    ...extra.map((bet) => ({
      key: bet.betId,
      nickname,
      amount: bet.amount,
      mine: true,
    })),
  ];
  // Totals come from the server only: a bet just accepted joins them with
  // the next frame, a quarter of a second later.
  return {
    lines,
    more: Math.max(0, totals.count - lines.length),
    count: totals.count,
    sum: totals.sum,
  };
}
