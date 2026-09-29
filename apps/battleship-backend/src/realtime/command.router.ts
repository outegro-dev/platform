import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type ClientMessage,
  clientMessageSchema,
} from "@outegro/contracts/battleship";
import { CLOCK, type Clock } from "@outegro/nest-common";
import type { RawData } from "ws";
import { GameError } from "../domain/errors.js";
import { GameService } from "../game/game.service.js";
import { LobbyService } from "../game/lobby.service.js";
import { EntitlementWatch } from "../players/entitlement.watch.js";
import { PlayersService } from "../players/players.service.js";
import type { Connection } from "./connection.js";

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
  return typeof seq === "number" && Number.isInteger(seq) && seq > 0
    ? seq
    : null;
}

/**
 * The socket gateway: validates every client message against the contract,
 * calls the lobby or the game, and maps rejections to `error { code, ref }`.
 * No rules here.
 */
@Injectable()
export class CommandRouter {
  private readonly logger = new Logger("CommandRouter");

  constructor(
    private readonly lobby: LobbyService,
    private readonly game: GameService,
    private readonly players: PlayersService,
    private readonly grants: EntitlementWatch,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** `session.ready`, the first message of every connection. */
  async welcome(connection: Connection): Promise<void> {
    const { userId } = connection;
    const [player, lobby] = await Promise.all([
      this.players.summary(userId),
      this.lobby.state(userId),
    ]);
    connection.send({
      type: "session.ready",
      payload: {
        player,
        activeMatchId: this.game.active(userId)?.id ?? null,
        queuedSince: lobby.queuedSince,
        room: lobby.room,
        serverTime: this.clock.now().toISOString(),
      },
    });
  }

  /** `match.state` right after `session.ready` when the user is playing. */
  async resume(connection: Connection): Promise<void> {
    if (this.game.active(connection.userId)) await this.game.sync(connection);
  }

  online(userId: string) {
    this.game.userOnline(userId);
    this.grants
      .watch(userId)
      .catch((error: unknown) =>
        this.logger.warn(
          { err: (error as Error).message },
          "Grant watch failed",
        ),
      );
  }

  offline(userId: string) {
    this.game.userOffline(userId);
    this.grants.unwatch(userId);
    this.lobby
      .userOffline(userId)
      .catch((error: unknown) =>
        this.logger.warn(
          { err: (error as Error).message },
          "Could not leave the queue",
        ),
      );
  }

  async handle(connection: Connection, data: RawData, isBinary: boolean) {
    const raw = decodeFrame(data, isBinary);
    const parsed = clientMessageSchema.safeParse(raw);
    if (!parsed.success) {
      connection.error("bad_message", seqOf(raw));
      return;
    }
    const message = parsed.data;
    try {
      await this.dispatch(connection, message);
    } catch (error) {
      if (error instanceof GameError) {
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

  private async dispatch(connection: Connection, message: ClientMessage) {
    const { userId } = connection;
    switch (message.type) {
      case "ping":
        connection.send({ type: "pong", payload: { t: message.payload.t } });
        return;
      case "queue.join":
        return this.lobby.joinQueue(userId);
      case "queue.leave":
        return this.lobby.leaveQueue(userId);
      case "bot.start":
        return this.lobby.startBot(userId, message.payload.level);
      case "room.create":
        return this.lobby.createRoom(userId);
      case "room.join":
        return this.lobby.joinRoom(userId, message.payload.code);
      case "room.cancel":
        return this.lobby.cancelRoom(userId);
      case "fleet.place":
        return this.game.placeFleet(userId, message.payload.ships);
      case "shot.fire":
        return this.game.fire(userId, message.payload.x, message.payload.y);
      case "match.resign":
        return this.game.resign(userId);
      case "match.sync":
        return this.game.sync(connection);
    }
  }
}
