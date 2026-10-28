import { randomUUID } from "node:crypto";
import { colorOf, multipliers } from "@outegro/roulette-engine";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bets, rounds } from "./db/schema.js";
import { RoundRepository } from "./rounds/round.repository.js";
import { SettlementService } from "./rounds/settlement.service.js";
import {
  type Harness,
  type Instance,
  OPENING_BALANCE,
  startHarness,
} from "./test/harness.js";

let h: Harness;
let a: Instance;

beforeAll(async () => {
  h = await startHarness();
  a = await h.boot("a");
  await h.advance(0);
});

afterAll(async () => {
  await h?.stop();
});

describe("settlement", () => {
  it("pays 2 100 winners in batches of 1 000 and pays nobody twice", async () => {
    const round = await a.round((view) => view.phase === "betting");
    const number = await h.fair.numberOf(round.round);
    const winning = colorOf(number);
    const losing = winning === "black" ? "red" : "black";
    // 2 500 bets straight into the record, as the bet path would leave them.
    const now = h.clock.now();
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: randomUUID(),
      roundId: round.round,
      userId: randomUUID(),
      clientBetId: randomUUID(),
      color: i < 2100 ? winning : losing,
      amount: 10 + (i % 7),
      createdAt: now,
    }));
    for (let i = 0; i < rows.length; i += 500)
      await h
        .db(a)
        .insert(bets)
        .values(rows.slice(i, i + 500));

    h.wallet.creditCalls.length = 0;
    await h.advance(new Date(round.bettingEndsAt).getTime() - now.getTime());
    await h.advance(7000);
    await a.round(
      (view) => view.round === round.round && view.phase === "settled",
    );
    expect(h.wallet.creditCalls).toEqual([1000, 1000, 100]);

    const [settled] = await h
      .db(a)
      .select()
      .from(rounds)
      .where(eq(rounds.id, round.round));
    const expectedPaid = rows
      .slice(0, 2100)
      .reduce((sum, bet) => sum + bet.amount * multipliers[winning], 0);
    expect(settled).toMatchObject({
      status: "settled",
      number,
      bets: 2500,
      staked: rows.reduce((sum, bet) => sum + bet.amount, 0),
      paidOut: expectedPaid,
    });
    const winner = rows[0];
    const loser = rows[2400];
    if (!winner || !loser) return;
    expect(await h.wallet.balance(winner.userId)).toBe(
      OPENING_BALANCE + winner.amount * multipliers[winning],
    );
    expect(await h.wallet.balance(loser.userId)).toBe(OPENING_BALANCE);

    // A second run (a new leader after a crash mid-settlement) changes nothing.
    const row = await a.app.get(RoundRepository).find(round.round);
    if (!row) return;
    expect(
      await a.app.get(SettlementService).settle({ ...row, status: "rolling" }),
    ).toBe(false);
    expect(await h.wallet.balance(winner.userId)).toBe(
      OPENING_BALANCE + winner.amount * multipliers[winning],
    );
  });
});
