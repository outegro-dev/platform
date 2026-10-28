import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type OwnBet,
  type RouletteClientMessage,
  rouletteClientMessageSchema,
  type TableView,
} from "@outegro/contracts/roulette";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { multipliers, type RoundTimings } from "@outegro/roulette-engine";
import type { RawData } from "ws";
import { BetError, BetService } from "../bets/bet.service.js";
import { ROUND_TIMINGS, WALLET } from "../common/tokens.js";
import { RoundFeed } from "../rounds/round.feed.js";
import { RoundRepository } from "../rounds/round.repository.js";
import { TableSettingsService } from "../table/table.settings.js";
import { balanceOrNull, type WalletPort } from "../wallet/wallet.port.js";
import type { Connection } from "./connection.js";
import { ConnectionRegistry } from "./connection.registry.js";

/** Results the welcome shows under the strip. */
const HISTORY_ON_WELCOME = 20;

/** Decodes a text frame; undefined when it is not JSON. */
export function decodeFrame(data: RawData, isBinary: boolean): unknown {
  if (isBinary) return undefined;
  try {
    const buffer = Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data);
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** The `seq` of a rejected message, when it has a usable one. */
export function seqOf(message: unknown): number | null {
  const seq = (message as { seq?: unknown } | null)?.seq;
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq > 0
    ? seq
    : null;
}

/**
 * The socket gateway: validates every client message against the contract,
 * hands bets to the bet path and maps refusals to `error { code, ref }`.
 */
@Injectable()
export class CommandRouter {
  private readonly logger = new Logger("CommandRouter");

  constructor(
    private readonly bets: BetService,
    private readonly feed: RoundFeed,
    private readonly repo: RoundRepository,
    private readonly registry: ConnectionRegistry,
    @Inject(WALLET) private readonly wallet: WalletPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ROUND_TIMINGS) private readonly timings: RoundTimings,
    private readonly settings: TableSettingsService,
  ) {}

  /** The table as players see it: limits, multipliers and phase lengths. */
  private async table(): Promise<TableView> {
    const settings = await this.settings.current();
    return {
      minBet: settings.minBet,
      maxBet: settings.maxBet,
      betsPerRound: settings.betsPerRound,
      payoutLimitPerColor: settings.payoutLimitPerColor,
      multipliers: { ...multipliers },
      timings: this.timings,
    };
  }

  /** `session.ready`, the first message of every connection; returns the bets it showed. */
  async welcome(connection: Connection): Promise<OwnBet[]> {
    const { userId } = connection;
    const [balance, round, history, table] = await Promise.all([
      balanceOrNull(this.wallet, userId),
      this.feed.current(),
      this.repo.history(HISTORY_ON_WELCOME),
      this.table(),
    ]);
    const yourBets = round
      ? (await this.repo.betsOfUser(round.round, userId)).map((bet) => ({
          betId: bet.id,
          clientBetId: bet.clientBetId,
          round: bet.roundId,
          color: bet.color,
          amount: bet.amount,
        }))
      : [];
    connection.send({
      type: "session.ready",
      payload: {
        player: { nickname: connection.nickname, balance },
        table,
        round,
        yourBets,
        history: history.flatMap((item) =>
          item.number !== null && item.color !== null
            ? [{ round: item.round, number: item.number, color: item.color }]
            : [],
        ),
        serverTime: this.clock.now().toISOString(),
      },
    });
    return yourBets;
  }

  async handle(connection: Connection, data: RawData, isBinary: boolean) {
    const raw = decodeFrame(data, isBinary);
    const parsed = rouletteClientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      connection.error("bad_message", seqOf(raw));
      return;
    }
    const message = parsed.data;
    try {
      await this.dispatch(connection, message);
    } catch (error) {
      if (error instanceof BetError) {
        connection.error(error.code, message.seq);
        return;
      }
      this.logger.error(
        { type: message.type, err: (error as Error).message },
        "Command failed",
      );
      connection.error("internal", message.seq);
    }
  }

  private async dispatch(
    connection: Connection,
    message: RouletteClientMessage,
  ) {
    switch (message.type) {
      case "ping":
        connection.send({
          type: "pong",
          ref: message.seq,
          payload: {
            t: message.payload.t,
            serverTime: this.clock.now().toISOString(),
          },
        });
        return;
      case "bet.place": {
        const { bet, balance } = await this.bets.place({
          userId: connection.userId,
          nickname: connection.nickname,
          ...message.payload,
        });
        this.registry.track(connection.userId, bet);
        // The player's other tabs see the bet and the new balance too.
        for (const tab of this.registry.connectionsOf(connection.userId))
          if (tab !== connection)
            tab.send({ type: "bet.accepted", payload: { bet, balance } });
        connection.send({
          type: "bet.accepted",
          ref: message.seq,
          payload: { bet, balance },
        });
        return;
      }
    }
  }
}
