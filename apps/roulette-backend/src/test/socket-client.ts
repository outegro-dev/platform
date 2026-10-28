import type {
  RouletteServerMessage,
  RouletteServerMessageType,
} from "@outegro/contracts/roulette";
import { WebSocket } from "ws";

type Of<T extends RouletteServerMessageType> = Extract<
  RouletteServerMessage,
  { type: T }
>;

type Waiter = {
  match: (message: RouletteServerMessage) => boolean;
  resolve: (message: RouletteServerMessage) => void;
  timer: NodeJS.Timeout;
};

export type BetAnswer =
  | { ok: true; message: Of<"bet.accepted"> }
  | { ok: false; code: string };

/**
 * A real `ws` client for tests. Collects every message; `next` returns the
 * earliest not-yet-consumed message that matches (others stay for later).
 */
export class TestSocket {
  readonly received: RouletteServerMessage[] = [];
  private readonly consumed = new Set<number>();
  private readonly waiters: Waiter[] = [];
  private seq = 0;
  readonly closed: Promise<{ code: number; reason: string }>;

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      this.received.push(JSON.parse(data.toString()) as RouletteServerMessage);
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

  send(type: string, payload: unknown): number {
    this.seq += 1;
    this.ws.send(JSON.stringify({ type, seq: this.seq, payload }));
    return this.seq;
  }

  sendRaw(data: string) {
    this.ws.send(data);
  }

  next<T extends RouletteServerMessageType>(
    type: T,
    match: (message: Of<T>) => boolean = () => true,
    timeoutMs = 10_000,
  ): Promise<Of<T>> {
    return this.nextMatching(
      (message) => message.type === type && match(message as Of<T>),
      `${type}`,
      timeoutMs,
    ) as Promise<Of<T>>;
  }

  /** Places a bet; the answer is the accepted bet or the refusal code. */
  bet(
    color: "red" | "black" | "green",
    amount: number,
    clientBetId: string = crypto.randomUUID(),
  ): Promise<BetAnswer> {
    return this.answer(this.send("bet.place", { clientBetId, color, amount }));
  }

  /** The answer to the bet message with this seq. */
  async answer(ref: number): Promise<BetAnswer> {
    const message = await this.nextMatching(
      (candidate) =>
        (candidate.type === "bet.accepted" && candidate.ref === ref) ||
        (candidate.type === "error" && candidate.payload.ref === ref),
      `answer to ${ref}`,
      15_000,
    );
    return message.type === "bet.accepted"
      ? { ok: true, message }
      : { ok: false, code: (message as Of<"error">).payload.code };
  }

  /** Round trip through the server: everything this socket asked for is done. */
  async sync(): Promise<void> {
    const t = Math.random();
    this.send("ping", { t });
    await this.next("pong", (message) => message.payload.t === t);
  }

  close() {
    this.ws.close();
    return this.closed;
  }

  private nextMatching(
    match: (message: RouletteServerMessage) => boolean,
    label: string,
    timeoutMs: number,
  ): Promise<RouletteServerMessage> {
    const index = this.find(match);
    if (index >= 0) {
      this.consumed.add(index);
      return Promise.resolve(this.received[index] as RouletteServerMessage);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(
            new Error(
              `timed out waiting for ${label}; got ${this.received.map((m) => m.type).join(", ")}`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private flush() {
    for (const waiter of [...this.waiters]) {
      const index = this.find(waiter.match);
      if (index < 0) continue;
      this.consumed.add(index);
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(this.received[index] as RouletteServerMessage);
    }
  }

  private find(match: (message: RouletteServerMessage) => boolean): number {
    for (let i = 0; i < this.received.length; i++)
      if (
        !this.consumed.has(i) &&
        match(this.received[i] as RouletteServerMessage)
      )
        return i;
    return -1;
  }
}
