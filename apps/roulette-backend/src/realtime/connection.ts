import { randomUUID } from "node:crypto";
import type { LoggerService } from "@nestjs/common";
import {
  type RouletteErrorCode,
  type RouletteServerMessage,
  rouletteServerMessageSchema,
} from "@outegro/contracts/roulette";
import { WebSocket } from "ws";
import type { TokenBucket } from "../domain/token-bucket.js";

const MAX_REFUSED_IN_ROW = 100;

/** A personal message before it is checked against the contract. */
export type Outgoing = {
  type: RouletteServerMessage["type"];
  ref?: number;
  payload: unknown;
};

/**
 * One open roulette socket. Personal messages are checked against the
 * contract before they leave; round frames arrive already serialized and go
 * out as they are, the same bytes to every socket. Commands of one socket
 * run one at a time, so a double click is two bets in a row, never a race.
 */
export class Connection {
  readonly id = randomUUID();
  /** Answered the last heartbeat ping. */
  alive = true;
  private queue: Promise<void> = Promise.resolve();
  private refusedInRow = 0;

  constructor(
    readonly userId: string,
    readonly nickname: string,
    private readonly socket: WebSocket,
    readonly budget: TokenBucket,
    private readonly log: LoggerService,
    private readonly maxBufferedBytes: number,
  ) {}

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: Outgoing): void {
    const parsed = rouletteServerMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.log.error(
        { type: message.type, issues: parsed.error.issues },
        "Outgoing message breaks the contract; not sent",
      );
      return;
    }
    this.sendFrame(JSON.stringify(parsed.data));
  }

  /** A frame serialized once for every socket (round state). */
  sendFrame(frame: string): void {
    if (!this.open) return;
    // A client that stopped reading gets nothing more queued.
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.log.warn(
        { connection: this.id, buffered: this.socket.bufferedAmount },
        "Client stopped reading; socket dropped",
      );
      this.socket.terminate();
      return;
    }
    this.socket.send(frame);
  }

  error(code: RouletteErrorCode, ref: number | null): void {
    this.send({
      type: "error",
      ...(ref ? { ref } : {}),
      payload: { code, ref },
    });
  }

  /** A frame over the rate limit; a client that keeps flooding is dropped. */
  refuse(ref: number | null): void {
    this.refusedInRow += 1;
    if (this.refusedInRow > MAX_REFUSED_IN_ROW) {
      if (this.refusedInRow === MAX_REFUSED_IN_ROW + 1)
        this.log.warn(
          { connection: this.id },
          "Client kept flooding; socket dropped",
        );
      this.socket.terminate();
      return;
    }
    this.error("rate_limited", ref);
  }

  accepted(): void {
    this.refusedInRow = 0;
  }

  /** Runs tasks strictly in arrival order; a failure does not stop the queue. */
  enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((error: unknown) => {
      this.log.error(
        { err: (error as Error).message },
        "Socket task failed unexpectedly",
      );
    });
  }

  ping(): void {
    this.socket.ping();
  }

  close(code: number, reason: string): void {
    this.socket.close(code, reason);
  }

  terminate(): void {
    this.socket.terminate();
  }
}
