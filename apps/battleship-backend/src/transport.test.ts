import { randomUUID } from "node:crypto";
import {
  defaultCosmetics,
  wsTicketSchema,
} from "@outegro/contracts/battleship";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { ConnectionRegistry } from "./realtime/connection.registry.js";
import { GameSocketServer } from "./realtime/socket.server.js";
import { type Harness, ORIGIN, startHarness } from "./test/harness.js";
import { TestSocket } from "./test/socket-client.js";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h?.close());

const open = (ticket: string | null, origin: string | null = ORIGIN) =>
  TestSocket.open(h.socketUrl(ticket), origin);

describe("handshake", () => {
  it("a fresh ticket opens the socket once, and session.ready comes first", async () => {
    const userId = randomUUID();
    const ticket = await h.ticketFor(userId);
    const socket = await open(ticket);
    const ready = await socket.next("session.ready");
    expect(socket.received[0]?.type).toBe("session.ready");
    expect(ready.seq).toBe(1);
    expect(ready.payload).toMatchObject({
      activeMatchId: null,
      queuedSince: null,
      room: null,
      player: { rating: 1000, premium: false, cosmetics: defaultCosmetics },
    });
    expect(ready.payload.player.nickname).toMatch(/^Sailor \d{4}$/);
    expect(JSON.stringify(ready)).not.toContain(userId);
    // Single use: the same ticket never opens a second socket.
    await expect(open(ticket)).rejects.toThrow("HTTP 401");
    await socket.close();
  });

  it("a ticket is only valid for 30 seconds", async () => {
    const ticket = await h.ticketFor(randomUUID());
    await h.advance(30_001);
    await expect(open(ticket)).rejects.toThrow("HTTP 401");
  });

  it("tickets are issued only against an access token", async () => {
    await h.http().post("/v1/ws-tickets").expect(401);
    const response = await h
      .http()
      .post("/v1/ws-tickets")
      .set(await h.auth(randomUUID()))
      .expect(201);
    expect(wsTicketSchema.parse(response.body).ticket).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(Date.parse(response.body.expiresAt) - h.clock.now().getTime()).toBe(
      30_000,
    );
  });

  it("refuses missing and forged tickets and other paths", async () => {
    await expect(open(null)).rejects.toThrow("HTTP 401");
    await expect(open("A".repeat(43))).rejects.toThrow("HTTP 401");
    await expect(open("short")).rejects.toThrow("HTTP 401");
    const ticket = await h.ticketFor(randomUUID());
    await expect(
      TestSocket.open(
        `ws://127.0.0.1:${new URL(h.socketUrl(ticket)).port}/v1/ws?ticket=${ticket}`,
        ORIGIN,
      ),
    ).rejects.toThrow("HTTP 404");
  });

  it("refuses origins that are not allowed, without spending the ticket", async () => {
    const ticket = await h.ticketFor(randomUUID());
    await expect(open(ticket, "https://evil.test")).rejects.toThrow("HTTP 403");
    await expect(open(ticket, null)).rejects.toThrow("HTTP 403");
    const socket = await open(ticket);
    await socket.next("session.ready");
    await socket.close();
  });
});

describe("messages", () => {
  it("answers bad messages with bad_message and the seq when there is one", async () => {
    const socket = await h.connect();
    socket.sendRaw("not json");
    expect((await socket.next("error")).payload).toEqual({
      code: "bad_message",
      ref: null,
    });
    const cases: [unknown, number | null][] = [
      [{ type: "admin.win", seq: 7, payload: {} }, 7],
      [{ type: "shot.fire", seq: 8, payload: { x: 10, y: 0 } }, 8],
      [{ type: "match.resign", seq: 9, payload: { winner: "me" } }, 9],
      [{ type: "ping", seq: 0, payload: { t: 1 } }, null],
      [{ type: "ping", payload: { t: 1 } }, null],
      [[1, 2, 3], null],
    ];
    for (const [message, ref] of cases) {
      socket.sendRaw(JSON.stringify(message));
      expect((await socket.next("error")).payload).toEqual({
        code: "bad_message",
        ref,
      });
    }
    socket.sendRaw(Buffer.from([1, 2, 3]));
    expect((await socket.next("error")).payload).toEqual({
      code: "bad_message",
      ref: null,
    });
    await socket.sync();
    // Server messages are numbered per connection.
    expect(socket.received.map((m) => m.seq)).toEqual(
      socket.received.map((_, i) => i + 1),
    );
    await socket.close();
  });

  it("allows bursts of 40 commands, then 20 per second", async () => {
    const socket = await h.connect();
    const seqs = Array.from({ length: 45 }, (_, i) =>
      socket.send("ping", { t: i }),
    );
    const limited = await Promise.all(
      seqs.slice(40).map((seq) => socket.error(seq)),
    );
    expect(limited.map((m) => m.payload.code)).toEqual(
      Array(5).fill("rate_limited"),
    );
    for (let t = 0; t < 40; t++)
      await socket.next("pong", (m) => m.payload.t === t);
    expect(socket.pending("pong")).toHaveLength(0);
    await h.advance(1_000);
    for (let t = 100; t < 120; t++) socket.send("ping", { t });
    for (let t = 100; t < 120; t++)
      await socket.next("pong", (m) => m.payload.t === t);
    await socket.close();
  });

  it("closes the socket on frames over 4 KB", async () => {
    const socket = await h.connect();
    socket.sendRaw(
      JSON.stringify({
        type: "ping",
        seq: 1,
        payload: { t: 1, pad: "x".repeat(5_000) },
      }),
    );
    expect((await socket.closed).code).toBe(1009);
  });

  it("pings every socket and drops the ones that stop answering", async () => {
    const healthy = await h.connect();
    const silent = await new Promise<WebSocket>((resolve, reject) => {
      void h.ticketFor(randomUUID()).then((ticket) => {
        const ws = new WebSocket(h.socketUrl(ticket), {
          origin: ORIGIN,
          autoPong: false,
        });
        ws.once("message", () => resolve(ws));
        ws.once("error", reject);
      });
    });
    const silentClosed = new Promise<number>((resolve) =>
      silent.on("close", resolve),
    );
    const server = h.get(GameSocketServer);
    const pinged = (ws: WebSocket) =>
      new Promise<void>((resolve) => ws.once("ping", () => resolve()));
    const both = Promise.all([pinged(healthy.ws), pinged(silent)]);
    server.sweep();
    await both;
    await healthy.sync();
    server.sweep();
    expect(await silentClosed).toBe(1006);
    await healthy.sync();
    await healthy.close();
  });

  it("several tabs of one player all receive the player's messages", async () => {
    const userId = randomUUID();
    const one = await h.connect(userId);
    const two = await h.connect(userId);
    one.send("queue.join", { mode: "quick" });
    const joined = await one.next("queue.joined");
    expect((await two.next("queue.joined")).payload).toEqual(joined.payload);
    // A new tab sees the queue in session.ready.
    const three = await h.connect(userId);
    expect(three.ready.queuedSince).toBe(joined.payload.since);
    two.send("queue.leave", {});
    await one.next("queue.left");
    await three.next("queue.left");
    await Promise.all([one.close(), two.close(), three.close()]);
  });
});

describe("service", () => {
  it("answers liveness and readiness probes", async () => {
    await h.http().get("/health").expect(200);
    const deep = await h.http().get("/health/deep").expect(200);
    expect(deep.body.info).toMatchObject({
      postgres: { status: "up" },
      valkey: { status: "up" },
      rabbitmq: { status: "up" },
    });
  });

  it("allows at most 8 sockets per player", async () => {
    const userId = randomUUID();
    const tabs = await Promise.all(
      Array.from({ length: 8 }, () => h.connect(userId)),
    );
    await expect(open(await h.ticketFor(userId))).rejects.toThrow("HTTP 429");
    await tabs[0]?.close();
    await expect
      .poll(() => h.get(ConnectionRegistry).socketsOf(userId))
      .toBe(7);
    const again = await h.connect(userId);
    await Promise.all([...tabs.slice(1), again].map((tab) => tab.close()));
  });
});

describe("shared Valkey", () => {
  it("keeps every key under battleship: and with a TTL", async () => {
    const waiting = await h.connect();
    waiting.send("queue.join", { mode: "quick" });
    await waiting.next("queue.joined");
    const host = await h.connect();
    host.send("room.create", {});
    await host.next("room.created");
    await h.ticketFor(randomUUID());
    const keys = await h.valkey.keys("*");
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const key of keys) {
      expect(key.startsWith("battleship:")).toBe(true);
      expect(await h.valkey.pttl(key)).toBeGreaterThan(0);
    }
    await Promise.all([waiting.close(), host.close()]);
  });
});
