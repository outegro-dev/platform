import { describe, expect, it } from "vitest";
import { columnView, SHOWN_LINES } from "./columns";
import { ownBet } from "./testing/fakes";

const line = (i: number, amount = 1000 - i) => ({
  betId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  nickname: `Player ${i}`,
  amount,
});

describe("columnView", () => {
  it("lists the top seven and counts the rest", () => {
    const view = columnView(
      {
        count: 12,
        sum: 9000,
        top: Array.from({ length: 7 }, (_, i) => line(i + 1)),
      },
      [],
      "Me",
    );
    expect(view.lines).toHaveLength(SHOWN_LINES);
    expect(view.more).toBe(5);
    expect(view.lines.some((item) => item.mine)).toBe(false);
  });

  it("marks your bet when it is in the top", () => {
    const top = [line(1), line(2)];
    const mine = ownBet({ betId: line(2).betId });
    const view = columnView({ count: 2, sum: 0, top }, [mine], "Me");
    expect(view.lines.map((item) => item.mine)).toEqual([false, true]);
  });

  it("always shows your bet, in place of the smallest listed one", () => {
    const view = columnView(
      {
        count: 20,
        sum: 0,
        top: Array.from({ length: 7 }, (_, i) => line(i + 1)),
      },
      [ownBet({ amount: 10 })],
      "Me",
    );
    expect(view.lines).toHaveLength(SHOWN_LINES);
    expect(view.lines.at(-1)).toMatchObject({
      nickname: "Me",
      amount: 10,
      mine: true,
    });
    expect(view.more).toBe(13);
  });
});
