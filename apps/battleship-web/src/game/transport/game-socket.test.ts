import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeEnvironment,
  FakeSocket,
  server,
  sessionReady,
} from "../testing/fakes";
import { Backoff } from "./backoff";
import { GameSocket, type GameSocketOptions, TicketError } from "./game-socket";

let tickets: string[];
let ticketCalls: number;

function createSocket(overrides: Partial<GameSocketOptions> = {}) {
  ticketCalls = 0;
  const logger = { warn: vi.fn() };
  const environment = new FakeEnvironment();
  const socket = new GameSocket({
    url: "wss://game.test/ws",
    tickets: async () => {
      ticketCalls++;
      return tickets.shift() ?? `ticket-${ticketCalls}-${"x".repeat(32)}`;
    },
    createSocket: (url) => new FakeSocket(url),
    random: () => 0.5,
    environment,
    logger,
    ...overrides,
  });
  return { socket, logger, environment };
}

/** Lets the async ticket fetch settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

async function connectReady(socket: GameSocket) {
  socket.start();
  await settle();
  FakeSocket.last.open();
  FakeSocket.last.receive(sessionReady());
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
  tickets = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GameSocket", () => {
  it("connects with a fresh one-time ticket and becomes ready on session.ready", async () => {
    tickets = [`first-${"a".repeat(32)}`];
    const { socket } = createSocket();
    const statuses: string[] = [];
    const ready = vi.fn();
    socket.on("status", (status) => statuses.push(status));
    socket.on("ready", ready);

    socket.start();
    await settle();
    expect(FakeSocket.last.url).toBe(
      `wss://game.test/ws?ticket=first-${"a".repeat(32)}`,
    );
    FakeSocket.last.open();
    expect(socket.status).toBe("connecting");
    FakeSocket.last.receive(sessionReady());

    expect(statuses).toEqual(["connecting", "ready"]);
    expect(ready).toHaveBeenCalledWith(
      expect.objectContaining({ reconnect: false }),
    );
  });

  it("queues commands until the session is up, then sends them in seq order", async () => {
    const { socket } = createSocket();
    socket.start();
    await settle();
    const first = socket.send("bot.start", { level: "easy" });
    const ping = socket.send("ping", { t: 1 });
    const second = socket.send("queue.leave", {});
    expect(FakeSocket.last.sent).toEqual([]);

    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());

    const sent = FakeSocket.last.sent;
    // Pings are never queued; the heartbeat pings right after the session starts.
    expect(sent.slice(0, 2)).toEqual([
      { type: "bot.start", seq: first, payload: { level: "easy" } },
      { type: "queue.leave", seq: second, payload: {} },
    ]);
    expect(sent[2]?.type).toBe("ping");
    expect(ping).not.toBeNull();
    const seqs = sent.map((message) => message.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("drops and logs messages that break the contract", async () => {
    const { socket, logger } = createSocket();
    const received = vi.fn();
    socket.on("message", received);
    await connectReady(socket);
    received.mockClear();

    FakeSocket.last.receive("not json");
    FakeSocket.last.receive({
      type: "shot.result",
      seq: 9,
      payload: { x: 11 },
    });
    FakeSocket.last.receive({ type: "admin.win", seq: 10, payload: {} });
    expect(received).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(3);

    FakeSocket.last.receive(server("queue.left", {}));
    expect(received).toHaveBeenCalledTimes(1);
  });

  it("reconnects with backoff and a new ticket per attempt", async () => {
    const { socket } = createSocket();
    const ready = vi.fn();
    socket.on("ready", ready);
    await connectReady(socket);
    const firstUrl = FakeSocket.last.url;

    FakeSocket.last.drop();
    expect(socket.status).toBe("reconnecting");
    // First retry: 0.5 s base, jitter centred (random 0.5).
    await vi.advanceTimersByTimeAsync(499);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(2);
    // That attempt fails too: the next delay doubles.
    FakeSocket.last.drop();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSocket.instances).toHaveLength(3);
    expect(ticketCalls).toBe(3);
    expect(new Set(FakeSocket.instances.map((s) => s.url)).size).toBe(3);
    expect(FakeSocket.last.url).not.toBe(firstUrl);

    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    expect(socket.status).toBe("ready");
    expect(ready).toHaveBeenLastCalledWith(
      expect.objectContaining({ reconnect: true }),
    );
    expect(socket.attempts).toBe(0);
  });

  it("keeps commands sent while reconnecting and delivers them on the new connection", async () => {
    const { socket } = createSocket();
    await connectReady(socket);
    FakeSocket.last.drop();
    const seq = socket.send("match.sync", {});
    await vi.advanceTimersByTimeAsync(500);
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    expect(FakeSocket.last.sent[0]).toEqual({
      type: "match.sync",
      seq,
      payload: {},
    });
  });

  it("stops retrying when the ticket is refused (signed out)", async () => {
    const { socket } = createSocket({
      tickets: async () => {
        throw new TicketError("unauthorized");
      },
    });
    socket.start();
    await settle();
    expect(socket.status).toBe("unauthorized");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("retries while the ticket endpoint is unavailable", async () => {
    let calls = 0;
    const { socket } = createSocket({
      tickets: async () => {
        calls++;
        if (calls < 3) throw new TicketError("unavailable");
        return `t-${"z".repeat(40)}`;
      },
    });
    socket.start();
    await settle();
    expect(socket.status).toBe("connecting");
    expect(socket.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(500 + 1000);
    expect(calls).toBe(3);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("measures round trips and replaces a connection that stops answering pings", async () => {
    const { socket } = createSocket();
    const rtt = vi.fn();
    socket.on("rtt", rtt);
    await connectReady(socket);
    const ping = FakeSocket.last.sent.find((m) => m.type === "ping");
    expect(ping).toBeDefined();
    await vi.advanceTimersByTimeAsync(42);
    FakeSocket.last.receive(
      server("pong", {
        t: (ping?.payload as { t: number } | undefined)?.t ?? 0,
      }),
    );
    expect(rtt).toHaveBeenCalledWith(42);
    expect(socket.rtt).toBe(42);

    // Next ping after 20 s; no pong within 10 s → a new connection.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeSocket.last.types().filter((t) => t === "ping")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.instances[0]?.closedWith).toBe(4000);
    expect(socket.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("reconnects at once when the tab becomes visible or the network returns", async () => {
    const { socket, environment } = createSocket();
    await connectReady(socket);
    FakeSocket.last.drop();
    FakeSocket.last.receive(server("queue.left", {}));
    environment.setVisible(false);
    environment.setVisible(true);
    await settle();
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.last.drop();
    environment.setOnline(false);
    expect(socket.status).toBe("offline");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    environment.setOnline(true);
    await settle();
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it("refuses outbound payloads that break the contract", async () => {
    const { socket } = createSocket();
    await connectReady(socket);
    const before = FakeSocket.last.sent.length;
    expect(socket.send("shot.fire", { x: 10, y: 0 })).toBeNull();
    expect(socket.send("room.join", { code: "bad" })).toBeNull();
    expect(FakeSocket.last.sent).toHaveLength(before);
  });

  it("stops cleanly and ignores late events from the old socket", async () => {
    const { socket } = createSocket();
    const received = vi.fn();
    socket.on("message", received);
    await connectReady(socket);
    const old = FakeSocket.last;
    received.mockClear();
    socket.stop();
    expect(socket.status).toBe("closed");
    old.receive(server("queue.left", {}));
    expect(received).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe("Backoff", () => {
  it("grows from 0.5 s to a 10 s cap with jitter", () => {
    const low = new Backoff(undefined, () => 0);
    const high = new Backoff(undefined, () => 0.999);
    const lows = Array.from({ length: 8 }, () => low.next());
    const highs = Array.from({ length: 8 }, () => high.next());
    for (const delay of [...lows, ...highs]) {
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(10_000);
    }
    expect(lows[0]).toBe(500);
    expect(highs.at(-1)).toBe(10_000);
    expect(lows[3]).toBeLessThan(highs[3] as number);
  });
});
