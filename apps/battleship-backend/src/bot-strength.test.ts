import {
  type CellState,
  classicRules,
  createBot,
  RandomPlacement,
  SeededRandom,
  type TargetView,
} from "@outegro/battleship-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GrantsConsumer } from "./events/grants.consumer.js";
import { type Harness, startHarness } from "./test/harness.js";
import type { Player } from "./test/play.js";

/**
 * TC-BS-05 over the real socket: 200 full matches per level against the
 * server's bots (slow on purpose; the same check through the session alone
 * lives in domain.test.ts, the pure strategies in the engine).
 */
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

describe("bot strength over the socket (TC-BS-05)", () => {
  /** One match of a random shooter (the engine's easy strategy) against a server bot. */
  async function playOnce(
    player: Player,
    level: "medium" | "expert",
    seed: number,
  ) {
    const random = new SeededRandom(seed * 104_729);
    const shooter = createBot("easy", random);
    const cells: CellState[][] = Array.from({ length: 10 }, () =>
      Array<CellState>(10).fill("unknown"),
    );
    const view: TargetView = { size: 10, cells, sunkShips: [], remaining: [1] };
    player.send("bot.start", { level });
    await player.next("match.state");
    player.send("fleet.place", {
      ships: new RandomPlacement(random).place(classicRules),
    });
    let turn: "you" | "opponent" | null = (await player.next("match.started"))
      .payload.turn;
    while (turn) {
      if (turn === "you") {
        const aim = shooter.next(view);
        player.send("shot.fire", { x: aim.x, y: aim.y });
        const result = (
          await player.next("shot.result", (m) => m.payload.by === "you")
        ).payload;
        (cells[aim.y] as CellState[])[aim.x] = result.outcome;
        for (const r of result.revealed)
          (cells[r.y] as CellState[])[r.x] = "miss";
        turn = result.nextTurn;
      } else {
        if (
          !player
            .pending("shot.result")
            .some((m) => m.payload.by === "opponent")
        )
          await h.advance(1_400);
        turn = (
          await player.next("shot.result", (m) => m.payload.by === "opponent")
        ).payload.nextTurn;
      }
    }
    return (await player.next("match.finished")).payload.winner === "opponent";
  }

  /** Share of `games` matches the bot wins, played on 10 sockets at once. */
  async function botWinRate(level: "medium" | "expert", games: number) {
    const lanes = 10;
    const wins = await Promise.all(
      Array.from({ length: lanes }, async (_, lane) => {
        const player = await h.connect();
        await h
          .get(GrantsConsumer)
          .apply(h.grantEvent({ userId: player.userId }));
        let won = 0;
        for (let seed = lane + 1; seed <= games; seed += lanes)
          if (await playOnce(player, level, seed)) won++;
        await player.close();
        return won;
      }),
    );
    return wins.reduce((sum, n) => sum + n, 0) / games;
  }

  it("the expert bot beats a random shooter in at least 95% of 200 games", async () => {
    expect(await botWinRate("expert", 200)).toBeGreaterThanOrEqual(0.95);
  }, 180_000);

  it("the medium bot beats a random shooter in at least 70% of 200 games", async () => {
    expect(await botWinRate("medium", 200)).toBeGreaterThanOrEqual(0.7);
  }, 180_000);
});
