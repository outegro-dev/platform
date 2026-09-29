import type {
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
} from "@outegro/contracts/battleship";
import { WebSocket } from "ws";

type Of<T extends ServerMessageType> = Extract<ServerMessage, { type: T }>;

type Waiter = {
  type: ServerMessageType;
  match: (message: ServerMessage) => boolean;
  resolve: (message: ServerMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

/**
 * A real `ws` client for tests. Collects every message; `next` returns the
 * earliest not-yet-consumed message of a type (others stay for later).
 */
export class TestSocket {
  readonly received: ServerMessage[] = [];
  /** Consumed out of order; everything below `open` is consumed too. */
  private readonly consumed = new Set<number>();
  private open = 0;
  private readonly waiters: Waiter[] = [];
  private seq = 0;
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.received.push(JSON.parse(data.toString()) as ServerMessage);
      this.flush();
    });
    this.closed = new Promise((resolve) =>
      ws.on("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      ),
    );
  }

  static open(url: string, origin: string | null): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, origin ? { origin } : {});
      const client = new TestSocket(ws);
      ws.once("open", () => resolve(client));
      ws.once("unexpected-response", (_req, res) =>
        reject(new Error(`HTTP ${res.statusCode}`)),
      );
      ws.once("error", reject);
    });
  }

  send(type: ClientMessageType, payload: unknown): number {
    this.seq += 1;
    this.ws.send(JSON.stringify({ type, seq: this.seq, payload }));
    return this.seq;
  }

  sendRaw(data: string | Buffer) {
    this.ws.send(data);
  }

  next<T extends ServerMessageType>(
    type: T,
    match: (message: Of<T>) => boolean = () => true,
    timeoutMs = 5_000,
  ): Promise<Of<T>> {
    const accepts = (message: ServerMessage) =>
      message.type === type && match(message as Of<T>);
    const index = this.find(accepts);
    if (index >= 0) {
      this.consume(index);
      return Promise.resolve(this.received[index] as Of<T>);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        type,
        match: accepts,
        resolve: resolve as (message: ServerMessage) => void,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(
            new Error(
              `timed out waiting for ${type}; got ${this.received
                .map((m, i) => `${this.isConsumed(i) ? "" : "*"}${m.type}`)
                .join(", ")}`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** An error reply to the message with this seq. */
  error(ref: number | null) {
    return this.next("error", (message) => message.payload.ref === ref);
  }

  /** Round trip through the server: everything this socket asked for is done. */
  async sync(): Promise<void> {
    const t = Math.random();
    this.send("ping", { t });
    await this.next("pong", (message) => message.payload.t === t);
  }

  /** Messages of a type not consumed yet. */
  pending<T extends ServerMessageType>(type: T): Of<T>[] {
    return this.received.filter(
      (message, i): message is Of<T> =>
        !this.isConsumed(i) && message.type === type,
    );
  }

  /** Marks everything received so far as consumed. */
  drain() {
    this.consumed.clear();
    this.open = this.received.length;
  }

  close() {
    this.ws.close();
    return this.closed;
  }

  private flush() {
    for (const waiter of [...this.waiters]) {
      const index = this.find(waiter.match);
      if (index < 0) continue;
      this.consume(index);
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(this.received[index] as ServerMessage);
    }
  }

  private isConsumed(index: number): boolean {
    return index < this.open || this.consumed.has(index);
  }

  /** Earliest unconsumed message matching; scans from the first open slot. */
  private find(match: (message: ServerMessage) => boolean): number {
    for (let i = this.open; i < this.received.length; i++)
      if (!this.consumed.has(i) && match(this.received[i] as ServerMessage))
        return i;
    return -1;
  }

  private consume(index: number) {
    this.consumed.add(index);
    while (this.consumed.has(this.open)) {
      this.consumed.delete(this.open);
      this.open++;
    }
  }
}
