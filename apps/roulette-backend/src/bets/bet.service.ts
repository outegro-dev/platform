import { setTimeout as sleep } from "node:timers/promises";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import type { OwnBet, RouletteErrorCode } from "@outegro/contracts/roulette";
import { type Color, checkStake, exposureOf } from "@outegro/roulette-engine";
import { RouletteMetrics } from "../common/metrics.js";
import { WALLET } from "../common/tokens.js";
import { tableConfig } from "../config/config.js";
import { betIdOf, betRef } from "../domain/ids.js";
import { RoundFeed } from "../rounds/round.feed.js";
import { RoundRepository } from "../rounds/round.repository.js";
import { RoundStore } from "../rounds/round.store.js";
import {
  WalletError,
  type WalletErrorCode,
  type WalletPort,
} from "../wallet/wallet.port.js";
import { BetWriter } from "./bet.writer.js";

/** A refused bet; no chips moved. */
export class BetError extends Error {
  constructor(readonly code: RouletteErrorCode) {
    super(code);
  }
}

/** The longest a player waits for the wallet before the bet is called off. */
export const DEBIT_TIMEOUT_MS = 2000;
const DUPLICATE_POLL_MS = 20;

const walletRefusal: Record<WalletErrorCode, RouletteErrorCode> = {
  insufficient_funds: "insufficient_funds",
  restricted: "wallet_restricted",
  // A debit after its rollback: the round closed while it was in flight.
  conflict: "round_closed",
  unavailable: "wallet_unavailable",
};

export type PlaceBet = {
  userId: string;
  nickname: string;
  clientBetId: string;
  color: Color;
  amount: number;
};

/**
 * The bet path (ADR-012): the Lua reserve in Valkey, the wallet debit with
 * `ref = roulette:bet:{betId}`, the batched commit to Postgres, and only
 * then the answer. Every way out after the reserve gives the place back,
 * and every way out after a possible debit rolls it back by ref.
 */
@Injectable()
export class BetService {
  private readonly logger = new Logger("BetService");

  constructor(
    private readonly feed: RoundFeed,
    private readonly store: RoundStore,
    private readonly repo: RoundRepository,
    private readonly writer: BetWriter,
    @Inject(WALLET) private readonly wallet: WalletPort,
    @Inject(tableConfig.KEY)
    private readonly table: ConfigType<typeof tableConfig>,
    private readonly metrics: RouletteMetrics,
  ) {}

  async place(input: PlaceBet): Promise<{ bet: OwnBet; balance: number }> {
    const started = performance.now();
    try {
      const result = await this.attempt(input);
      this.metrics.bet("accepted", (performance.now() - started) / 1000);
      return result;
    } catch (error) {
      const code = error instanceof BetError ? error.code : "internal";
      this.metrics.bet(code, (performance.now() - started) / 1000);
      throw error;
    }
  }

  private async attempt(input: PlaceBet) {
    const stake = checkStake(input.amount, this.table);
    if (stake) throw new BetError(stake);
    const view = await this.feed.current();
    if (view?.phase !== "betting") throw new BetError("round_closed");
    const round = view.round;
    const betId = betIdOf(input.userId, input.clientBetId);
    const place = {
      round,
      userId: input.userId,
      clientBetId: input.clientBetId,
      betId,
      color: input.color,
      exposure: exposureOf(input.color, input.amount),
    };
    const deadline = performance.now() + DEBIT_TIMEOUT_MS + 1000;
    for (;;) {
      const reserved = await this.store.reserve({
        ...place,
        maxBets: this.table.betsPerRound,
        payoutLimit: this.table.payoutLimitPerColor,
      });
      if (reserved.status === "ok") break;
      if (reserved.status !== "duplicate") throw new BetError(reserved.status);
      // A double click or a retry: the first attempt owns the debit. Its
      // bet is the answer; if it gave the place back, this one tries anew.
      const recorded = await this.awaitFirstAttempt(place, deadline);
      if (recorded) {
        const bet = {
          betId,
          clientBetId: input.clientBetId,
          round: recorded.roundId,
          color: recorded.color,
          amount: recorded.amount,
        };
        return { bet, balance: await this.wallet.balance(input.userId) };
      }
      if (performance.now() > deadline)
        throw new BetError("wallet_unavailable");
    }

    const debit = {
      userId: input.userId,
      amount: input.amount,
      ref: betRef(betId),
      meta: { game: "roulette" as const, round, color: input.color },
    };
    let balance: number;
    try {
      ({ balance } = await withTimeout(
        this.wallet.debit(debit),
        DEBIT_TIMEOUT_MS,
      ));
    } catch (error) {
      const code =
        error instanceof WalletError ? error.code : ("unavailable" as const);
      // Without an answer the debit may have happened: call it off by ref.
      if (code === "unavailable") await this.rollBack(debit.ref);
      await this.store.release(place);
      throw new BetError(walletRefusal[code]);
    }

    const outcome = await this.writer
      .write({
        id: betId,
        roundId: round,
        userId: input.userId,
        clientBetId: input.clientBetId,
        color: input.color,
        amount: input.amount,
      })
      .catch(async (error: unknown) => {
        this.logger.error(
          { round, err: (error as Error).message },
          "Bet not recorded; debit rolled back",
        );
        await this.rollBack(debit.ref);
        await this.store.release(place);
        throw new BetError("internal");
      });
    if (outcome === "closed") {
      await this.rollBack(debit.ref);
      await this.store.release(place);
      throw new BetError("round_closed");
    }
    await this.store.confirm({
      round,
      betId,
      color: input.color,
      amount: input.amount,
      nickname: input.nickname,
    });
    return {
      bet: {
        betId,
        clientBetId: input.clientBetId,
        round,
        color: input.color,
        amount: input.amount,
      },
      balance,
    };
  }

  /**
   * Waits for the first attempt of the same bet: its row once recorded, or
   * null as soon as it gave its place back (or the deadline passes).
   */
  private async awaitFirstAttempt(
    place: {
      round: number;
      userId: string;
      clientBetId: string;
      betId: string;
    },
    deadline: number,
  ) {
    while (performance.now() < deadline) {
      const recorded = await this.repo.findBet(place.betId);
      if (recorded) return recorded;
      if ((await this.store.reservedBet(place)) !== place.betId) return null;
      await sleep(DUPLICATE_POLL_MS);
    }
    return null;
  }

  /** A rollback that fails is left to the close and the wallet's reconciliation. */
  private async rollBack(ref: string) {
    await this.wallet
      .rollback(ref)
      .catch((error: unknown) =>
        this.logger.error(
          { ref, err: (error as Error).message },
          "Rollback failed; left to reconciliation",
        ),
      );
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WalletError("unavailable")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
