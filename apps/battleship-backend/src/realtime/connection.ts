import { randomUUID } from "node:crypto";
import {
  type GameErrorCode,
  serverMessageSchema,
} from "@outegro/contracts/battleship";
import { WebSocket } from "ws";
import type { Outgoing } from "../domain/game/types.js";
import type { LogPort } from "../domain/ports.js";
import type { TokenBucket } from "../domain/token-bucket.js";

/**
 * One open game socket of a user. Numbers outgoing messages (`seq` grows per
 * connection), validates each against the contract before it leaves (extra
 * fields are stripped) and runs the user's commands one at a time.
 */
export class Connection {
  readonly id = randomUUID();
  /** Answered the last heartbeat ping. */
  alive = true;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly userId: string,
    private readonly socket: WebSocket,
    readonly budget: TokenBucket,
    private readonly log: LogPort,
    /** Unsent bytes a client may leave on the server before it is dropped. */
    private readonly maxBufferedBytes: number,
  ) {}

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  send(message: Outgoing): void {
    if (!this.open) return;
    // A client that stopped reading gets nothing more queued: the replies to
    // a flood of refused frames would pile up in memory until the heartbeat
    // noticed, up to 50 seconds later.
    if (this.socket.bufferedAmount > this.maxBufferedBytes) {
      this.log.warn(
        { connection: this.id, buffered: this.socket.bufferedAmount },
        "Client stopped reading; socket dropped",
      );
      this.socket.terminate();
      return;
    }
    const parsed = serverMessageSchema.safeParse({
      type: message.type,
      seq: this.seq + 1,
      payload: message.payload,
    });
    if (!parsed.success) {
      this.log.error(
        { type: message.type, issues: parsed.error.issues },
        "Outgoing message breaks the contract; not sent",
      );
      return;
    }
    this.seq += 1;
    this.socket.send(JSON.stringify(parsed.data));
  }

  error(code: GameErrorCode, ref: number | null): void {
    this.send({ type: "error", payload: { code, ref } });
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
