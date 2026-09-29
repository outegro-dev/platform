import { autorun } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { profile, server, sessionReady, snapshot } from "../testing/fakes";
import type { MessageSender } from "../transport/game-socket";
import { Clock } from "./clock";
import { LobbyStore, normalizeRoomCode } from "./lobby-store";
import { SessionStore } from "./session-store";

function setup(premium = false) {
  const sent: { type: string; seq: number; payload: unknown }[] = [];
  let seq = 0;
  const sender: MessageSender = {
    send: vi.fn((type, payload) => {
      seq++;
      sent.push({ type, seq, payload });
      return seq;
    }),
  };
  const session = new SessionStore(
    { signedIn: true, profile: { ...profile, premium } },
    { fetchProfile: async () => null },
  );
  const clock = new Clock();
  const lobby = new LobbyStore(sender, session, clock);
  return { lobby, sent, session, clock };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LobbyStore", () => {
  it("locks hard and expert bots without Premium and never asks the server", () => {
    const { lobby, sent } = setup(false);
    expect(lobby.isLocked("easy")).toBe(false);
    expect(lobby.isLocked("hard")).toBe(true);
    expect(lobby.startBot("expert")).toBe(false);
    expect(lobby.error).toBe("premium_required");
    expect(sent).toHaveLength(0);
  });

  it("starts a bot game and follows into the match when it opens", () => {
    const { lobby, sent } = setup(true);
    expect(lobby.startBot("hard")).toBe(true);
    expect(sent[0]).toMatchObject({
      type: "bot.start",
      payload: { level: "hard" },
    });
    expect(lobby.isBusy("bot")).toBe(true);
    lobby.handle(
      server("match.state", { match: snapshot({ phase: "placement" }) }),
    );
    expect(lobby.pending).toBeNull();
    expect(lobby.matchRequested).toBe(1);
  });

  it("shows the server's premium_required refusal for the command it answers", () => {
    const { lobby } = setup(true);
    lobby.startBot("expert");
    lobby.handle(server("error", { code: "premium_required", ref: 99 }));
    expect(lobby.error).toBeNull();
    lobby.handle(server("error", { code: "premium_required", ref: 1 }));
    expect(lobby.error).toBe("premium_required");
    expect(lobby.pending).toBeNull();
  });

  it("tracks the quick-match search and its elapsed time", () => {
    const { lobby, clock } = setup();
    clock.sync(new Date().toISOString());
    lobby.joinQueue();
    expect(lobby.isBusy("queue.join")).toBe(true);
    lobby.handle(
      server("queue.joined", {
        mode: "quick",
        since: new Date().toISOString(),
      }),
    );
    expect(lobby.queued).toBe(true);
    const seconds: number[] = [];
    const stop = autorun(() => seconds.push(lobby.queueSeconds));
    vi.advanceTimersByTime(12_000);
    expect(lobby.queueSeconds).toBe(12);
    stop();

    lobby.handle(
      server("queue.matched", {
        matchId: "00000000-0000-4000-8000-00000000000b",
      }),
    );
    expect(lobby.queued).toBe(false);
    expect(lobby.matchRequested).toBe(1);
  });

  it("restores the queue and a room from session.ready", () => {
    const { lobby } = setup();
    lobby.handle(
      sessionReady({
        queuedSince: "2026-09-29T11:59:30.000Z",
        room: { code: "K7M2QX", expiresAt: "2026-09-29T12:10:00.000Z" },
      }),
    );
    expect(lobby.queued).toBe(true);
    expect(lobby.room?.code).toBe("K7M2QX");
  });

  it("creates, cancels and joins private rooms", () => {
    const { lobby, sent } = setup();
    lobby.createRoom();
    lobby.handle(
      server("room.created", {
        code: "K7M2QX",
        expiresAt: "2026-09-29T12:10:00.000Z",
      }),
    );
    expect(lobby.room?.code).toBe("K7M2QX");
    expect(lobby.roomSecondsLeft).toBe(600);
    lobby.cancelRoom();
    lobby.handle(server("room.cancelled", { reason: "cancelled" }));
    expect(lobby.room).toBeNull();
    expect(lobby.roomClosed).toBe("cancelled");

    expect(lobby.joinRoom(" k7m2-qx ")).toBe(true);
    expect(sent.at(-1)).toMatchObject({
      type: "room.join",
      payload: { code: "K7M2QX" },
    });
    lobby.handle(
      server("error", { code: "room_not_found", ref: sent.at(-1)?.seq ?? 0 }),
    );
    expect(lobby.error).toBe("room_not_found");
  });

  it("rejects malformed room codes before sending", () => {
    const { lobby, sent } = setup();
    expect(lobby.joinRoom("K0M2QX")).toBe(false);
    expect(lobby.error).toBe("invalid_room_code");
    expect(sent).toHaveLength(0);
    expect(normalizeRoomCode("ab cd-ef")).toBe("ABCDEF");
  });

  it("a room match opens for the creator too", () => {
    const { lobby } = setup();
    lobby.createRoom();
    lobby.handle(
      server("room.created", {
        code: "K7M2QX",
        expiresAt: "2026-09-29T12:10:00.000Z",
      }),
    );
    lobby.handle(
      server("match.state", {
        match: snapshot({ mode: "private", phase: "placement" }),
      }),
    );
    expect(lobby.room).toBeNull();
    expect(lobby.matchRequested).toBe(1);
  });
});
