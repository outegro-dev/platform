import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { type RawData, type WebSocket, WebSocketServer } from "ws";
import { RouletteMetrics } from "../common/metrics.js";
import { realtimeConfig } from "../config/config.js";
import { TokenBucket } from "../domain/token-bucket.js";
import { PlayersService } from "../players/players.service.js";
import { CommandRouter, decodeFrame, seqOf } from "./command.router.js";
import { Connection } from "./connection.js";
import { ConnectionRegistry } from "./connection.registry.js";
import { TicketStore } from "./ticket.store.js";

/** Transport limits of the roulette socket. */
export const socketLimits = {
  path: "/ws",
  /** Larger frames close the socket (1009). */
  maxPayloadBytes: 2 * 1024,
  commandsPerSecond: 10,
  burst: 20,
  pingEveryMs: 25_000,
  socketsPerUser: 8,
  /** A round frame is ~3 KB at 4 a second; a client this far behind is dropped. */
  maxBufferedBytes: 1024 * 1024,
} as const;

const statusText: Record<number, string> = {
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  503: "Service Unavailable",
};

/**
 * The roulette socket on the HTTP server's port (`/ws`, plain `ws`), as in
 * Battleship: the upgrade needs an allowed Origin and a fresh single-use
 * ticket; every frame is budgeted and silent sockets are dropped.
 */
@Injectable()
export class RouletteSocketServer
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger("RouletteSocket");
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: socketLimits.maxPayloadBytes,
    clientTracking: false,
  });
  private heartbeat: NodeJS.Timeout | undefined;
  private stopping = false;
  private server: Server | undefined;
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void this.upgrade(request, socket, head);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tickets: TicketStore,
    private readonly registry: ConnectionRegistry,
    private readonly router: CommandRouter,
    private readonly players: PlayersService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(realtimeConfig.KEY)
    private readonly config: ConfigType<typeof realtimeConfig>,
    private readonly metrics: RouletteMetrics,
  ) {}

  onApplicationBootstrap() {
    this.server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.server.on("upgrade", this.onUpgrade);
    this.heartbeat = setInterval(() => this.sweep(), socketLimits.pingEveryMs);
    this.heartbeat.unref();
  }

  /** Closes every socket before the rest shuts down; clients reconnect. */
  onModuleDestroy() {
    this.stopping = true;
    clearInterval(this.heartbeat);
    this.server?.off("upgrade", this.onUpgrade);
    for (const connection of [...this.registry.connections()])
      connection.close(1012, "service restart");
    this.wss.close();
  }

  /** One heartbeat round: sockets that missed the last ping are terminated. */
  sweep() {
    for (const connection of [...this.registry.connections()]) {
      if (!connection.alive) {
        connection.terminate();
        continue;
      }
      connection.alive = false;
      connection.ping();
    }
  }

  private async upgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) {
    const onError = () => socket.destroy();
    socket.on("error", onError);
    try {
      const url = new URL(request.url ?? "/", "http://socket.local");
      if (url.pathname !== socketLimits.path) return this.refuse(socket, 404);
      const origin = request.headers.origin;
      if (this.stopping) return this.refuse(socket, 503);
      if (!origin || !this.config.allowedOrigins.includes(origin))
        return this.refuse(socket, 403, { origin: origin ?? null });
      const userId = await this.tickets.consume(url.searchParams.get("ticket"));
      if (!userId) return this.refuse(socket, 401);
      const player = await this.players.find(userId);
      if (player?.status !== "active")
        return this.refuse(socket, 403, { userId });
      if (this.registry.socketsOf(userId) >= socketLimits.socketsPerUser)
        return this.refuse(socket, 429, { userId });
      socket.off("error", onError);
      this.wss.handleUpgrade(request, socket, head, (ws) =>
        this.accept(ws, userId, player.nickname),
      );
    } catch (error) {
      this.logger.error({ err: (error as Error).message }, "Upgrade failed");
      this.refuse(socket, 503);
    }
  }

  private refuse(
    socket: Duplex,
    status: number,
    detail: Record<string, unknown> = {},
  ) {
    if (status !== 404)
      this.logger.log({ status, ...detail }, "Upgrade refused");
    this.metrics.upgradeRefused(status);
    if (socket.writable)
      socket.write(
        `HTTP/1.1 ${status} ${statusText[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    socket.destroy();
  }

  private accept(socket: WebSocket, userId: string, nickname: string) {
    const connection = new Connection(
      userId,
      nickname,
      socket,
      new TokenBucket(
        this.clock,
        socketLimits.commandsPerSecond,
        socketLimits.burst,
      ),
      this.logger,
      socketLimits.maxBufferedBytes,
    );
    socket.on("message", (data, isBinary) =>
      this.receive(connection, data, isBinary),
    );
    socket.on("pong", () => {
      connection.alive = true;
    });
    socket.on("error", (error) =>
      this.logger.warn({ err: error.message }, "Socket error"),
    );
    socket.on("close", (code) => this.closed(connection, code));
    // session.ready first; round frames only after it.
    connection.enqueue(async () => {
      try {
        const yourBets = await this.router.welcome(connection);
        if (!connection.open || this.stopping) return;
        this.registry.add(connection);
        for (const bet of yourBets) this.registry.track(userId, bet);
        this.metrics.socketsOpen(this.registry.stats().sockets);
      } catch (error) {
        this.logger.error({ err: (error as Error).message }, "Welcome failed");
        connection.close(1011, "try again");
        return;
      }
      if (this.stopping) connection.close(1012, "service restart");
    });
  }

  private receive(connection: Connection, data: RawData, isBinary: boolean) {
    if (!connection.budget.take()) {
      connection.refuse(seqOf(decodeFrame(data, isBinary)));
      return;
    }
    connection.accepted();
    connection.enqueue(() => this.router.handle(connection, data, isBinary));
  }

  private closed(connection: Connection, code: number) {
    this.logger.debug?.({ connection: connection.id, code }, "Socket closed");
    this.registry.remove(connection);
    this.metrics.socketsOpen(this.registry.stats().sockets);
  }
}
