import type {
  OwnBet,
  RouletteClientMessage,
  RouletteServerMessage,
  RouletteServerPayload,
  RoundView,
} from "@outegro/contracts/roulette";
import { Emitter } from "../transport/emitter";
import type {
  ClientPayload,
  Environment,
  MessageSender,
  RouletteSocketEvents,
  SocketLike,
  SocketStatus,
} from "../transport/roulette-socket";

/** A WebSocket stand-in the test drives from the server side. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly sent: RouletteClientMessage[] = [];

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error("no socket was created");
    return socket;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as RouletteClientMessage);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: RouletteServerMessage | string | object): void {
    this.onmessage?.({
      data: typeof message === "string" ? message : JSON.stringify(message),
    });
  }

  /** The connection dies (network, server restart). */
  drop(code = 1006): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
}

/** Visibility and network the test flips. */
export class FakeEnvironment implements Environment {
  isVisible = true;
  isOnline = true;
  private readonly events = new Emitter<{
    visible: boolean;
    online: boolean;
  }>();
  visible = () => this.isVisible;
  online = () => this.isOnline;
  onVisibilityChange = (listener: (visible: boolean) => void) =>
    this.events.on("visible", listener);
  onOnlineChange = (listener: (online: boolean) => void) =>
    this.events.on("online", listener);
  setOnline(online: boolean) {
    this.isOnline = online;
    this.events.emit("online", online);
  }
}

/** The store's view of the socket, driven by the test. */
export class FakeSender implements MessageSender {
  status: SocketStatus = "idle";
  readonly sent: { type: string; seq: number; payload: unknown }[] = [];
  private seq = 0;
  private readonly events = new Emitter<RouletteSocketEvents>();

  send<T extends RouletteClientMessage["type"]>(
    type: T,
    payload: ClientPayload<T>,
  ): number | null {
    if (this.status !== "ready") return null;
    this.seq += 1;
    this.sent.push({ type, seq: this.seq, payload });
    return this.seq;
  }

  on<K extends keyof RouletteSocketEvents>(
    event: K,
    listener: (payload: RouletteSocketEvents[K]) => void,
  ) {
    return this.events.on(event, listener);
  }

  start(): void {}
  stop(): void {}
  retryNow(): void {}

  setStatus(status: SocketStatus) {
    this.status = status;
    this.events.emit("status", status);
  }

  deliver(message: RouletteServerMessage) {
    this.events.emit("message", message);
  }
}

export const NICKNAME = "Player 4821";
const ROUND_START = Date.parse("2026-10-28T10:00:00.000Z");

const emptyTotals = () => ({ count: 0, sum: 0, top: [] });

export function roundView(overrides: Partial<RoundView> = {}): RoundView {
  return {
    round: 7,
    phase: "betting",
    bettingEndsAt: new Date(ROUND_START + 20_000).toISOString(),
    rollingAt: null,
    settleAt: null,
    nextRoundAt: null,
    result: null,
    totals: { red: emptyTotals(), black: emptyTotals(), green: emptyTotals() },
    table: { paused: false, maintenance: false },
    ...overrides,
  };
}

export const table = {
  minBet: 10,
  maxBet: 100_000,
  betsPerRound: 3,
  payoutLimitPerColor: 1_000_000,
  multipliers: { red: 2, black: 2, green: 14 },
  timings: {
    bettingMs: 20_000,
    lockedMs: 1000,
    rollingMs: 6000,
    settledMs: 3000,
  },
};

export function sessionReady(
  overrides: Partial<RouletteServerPayload<"session.ready">> = {},
): RouletteServerMessage {
  return {
    type: "session.ready",
    payload: {
      player: { nickname: NICKNAME, balance: 1000 },
      table,
      round: roundView(),
      yourBets: [],
      history: [{ round: 6, number: 8, color: "black" }],
      serverTime: new Date(ROUND_START + 5000).toISOString(),
      ...overrides,
    },
  };
}

export function ownBet(overrides: Partial<OwnBet> = {}): OwnBet {
  return {
    betId: "00000000-0000-4000-8000-0000000000b1",
    clientBetId: "00000000-0000-4000-8000-0000000000c1",
    round: 7,
    color: "red",
    amount: 100,
    ...overrides,
  };
}
