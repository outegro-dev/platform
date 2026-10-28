import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeEnvironment,
  FakeSocket,
  roundView,
  sessionReady,
} from "../testing/fakes";
import {
  RouletteSocket,
  type RouletteSocketOptions,
  TicketError,
} from "./roulette-socket";

function createSocket(overrides: Partial<RouletteSocketOptions> = {}) {
  const logger = { warn: vi.fn() };
  const environment = new FakeEnvironment();
  let calls = 0;
  const socket = new RouletteSocket({
    url: "wss://roulette.test/ws",
    tickets: async () => `ticket-${++calls}-${"x".repeat(32)}`,
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

async function connectReady(socket: RouletteSocket) {
  socket.start();
  await settle();
  FakeSocket.last.open();
  FakeSocket.last.receive(sessionReady());
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RouletteSocket", () => {
  it("connects with a one-time ticket and is ready on session.ready", async () => {
    const { socket } = createSocket();
    const statuses: string[] = [];
    socket.on("status", (status) => statuses.push(status));
    await connectReady(socket);
    expect(FakeSocket.last.url).toBe(
      `wss://roulette.test/ws?ticket=ticket-1-${"x".repeat(32)}`,
    );
    expect(statuses).toEqual(["connecting", "ready"]);
    // The heartbeat pings right away.
    expect(FakeSocket.last.sent.map((message) => message.type)).toEqual([
      "ping",
    ]);
  });

  it("sends bets only with a session: nothing is queued for later", async () => {
    const { socket } = createSocket();
    socket.start();
    await settle();
    const bet = {
      clientBetId: "00000000-0000-4000-8000-000000000001",
      color: "red" as const,
      amount: 100,
    };
    expect(socket.send("bet.place", bet)).toBeNull();
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    const seq = socket.send("bet.place", bet);
    expect(seq).toBe(2);
    expect(FakeSocket.last.sent.at(-1)).toEqual({
      type: "bet.place",
      seq: 2,
      payload: bet,
    });
  });

  it("drops messages that break the contract", async () => {
    const { socket, logger } = createSocket();
    const messages = vi.fn();
    socket.on("message", messages);
    await connectReady(socket);
    messages.mockClear();
    FakeSocket.last.receive({ type: "round.state", payload: { round: 1 } });
    FakeSocket.last.receive("not json");
    expect(messages).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    FakeSocket.last.receive({
      type: "round.state",
      payload: { round: roundView() },
    });
    expect(messages).toHaveBeenCalledTimes(1);
  });

  it("reports pongs with the server's time", async () => {
    const { socket } = createSocket();
    const pongs = vi.fn();
    socket.on("pong", pongs);
    await connectReady(socket);
    const ping = FakeSocket.last.sent[0];
    await vi.advanceTimersByTimeAsync(40);
    FakeSocket.last.receive({
      type: "pong",
      ref: 1,
      payload: {
        t: (ping?.payload as { t: number } | undefined)?.t ?? 0,
        serverTime: "2026-10-28T10:00:05.000Z",
      },
    });
    expect(pongs).toHaveBeenCalledWith(
      expect.objectContaining({
        rtt: 40,
        serverTime: "2026-10-28T10:00:05.000Z",
      }),
    );
  });

  it("reconnects with backoff after a drop, with a fresh ticket", async () => {
    const { socket } = createSocket();
    await connectReady(socket);
    FakeSocket.last.drop();
    expect(socket.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(FakeSocket.last.url).toContain("ticket-2-");
  });

  it("stops when the ticket is refused: the session is over", async () => {
    const { socket } = createSocket({
      tickets: async () => {
        throw new TicketError("unauthorized");
      },
    });
    socket.start();
    await settle();
    expect(socket.status).toBe("unauthorized");
    expect(FakeSocket.instances).toHaveLength(0);
  });

  it("waits for the network instead of retrying offline", async () => {
    const { socket, environment } = createSocket();
    environment.isOnline = false;
    socket.start();
    expect(socket.status).toBe("offline");
    environment.setOnline(true);
    await settle();
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
