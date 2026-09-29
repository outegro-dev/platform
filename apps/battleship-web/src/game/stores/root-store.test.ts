import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeEnvironment,
  FakeSocket,
  MATCH_ID,
  profile,
  server,
  sessionReady,
  snapshot,
} from "../testing/fakes";
import { RootStore } from "./root-store";

function setup() {
  const environment = new FakeEnvironment();
  const root = new RootStore({
    signedIn: true,
    profile,
    socketUrl: "wss://game.test/ws",
    tickets: async () => `ticket-${"q".repeat(40)}`,
    createSocket: (url) => new FakeSocket(url),
    profileSource: { fetchProfile: async () => profile },
    shopApi: {
      startCheckout: vi.fn(),
      equip: vi.fn(),
      fetchProfile: async () => profile,
    },
    statsApi: { leaderboard: vi.fn(), matches: vi.fn() },
    navigate: vi.fn(),
    environment,
    logger: { warn: vi.fn() },
  });
  return { root, environment };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RootStore", () => {
  it("fans messages out to the stores and mirrors the connection", async () => {
    const { root } = setup();
    root.start();
    await settle();
    expect(root.session.connection).toBe("connecting");
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady({ activeMatchId: MATCH_ID }));
    expect(root.session.connection).toBe("ready");
    expect(root.session.nickname).toBe("Sailor 4821");
    // A tab that opens during a match asks for the snapshot.
    expect(FakeSocket.last.types()).toContain("match.sync");
    FakeSocket.last.receive(server("match.state", { match: snapshot() }));
    expect(root.match.matchId).toBe(MATCH_ID);
    expect(root.placement.submitted).toBe(true);
    root.dispose();
  });

  it("asks for match.sync after a reconnect during a match", async () => {
    const { root } = setup();
    root.start();
    await settle();
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    FakeSocket.last.receive(server("match.state", { match: snapshot() }));

    FakeSocket.last.drop();
    expect(root.session.connection).toBe("reconnecting");
    expect(root.session.attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(700);
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady({ activeMatchId: MATCH_ID }));
    expect(FakeSocket.last.types()).toContain("match.sync");
    expect(root.session.connection).toBe("ready");
    root.dispose();
  });

  it("notices a match that ended while the connection was gone", async () => {
    const { root } = setup();
    root.start();
    await settle();
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    FakeSocket.last.receive(server("match.state", { match: snapshot() }));
    FakeSocket.last.drop();
    await vi.advanceTimersByTimeAsync(700);
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady({ activeMatchId: null }));
    expect(root.match.endedWhileAway).toBe(true);
    root.dispose();
  });

  it("lands queued animations at once when the tab is hidden", async () => {
    const { root, environment } = setup();
    root.start();
    await settle();
    FakeSocket.last.open();
    FakeSocket.last.receive(sessionReady());
    FakeSocket.last.receive(
      server("match.state", { match: snapshot({ turn: "opponent" }) }),
    );
    FakeSocket.last.receive(
      server("shot.result", {
        by: "opponent",
        x: 0,
        y: 0,
        outcome: "hit",
        revealed: [],
        nextTurn: "opponent",
        deadline: null,
      }),
    );
    expect(root.match.ownShots[0]?.[0]).toBe("unknown");
    environment.setVisible(false);
    expect(root.match.ownShots[0]?.[0]).toBe("hit");
    root.dispose();
  });

  it("does not connect while signed out", async () => {
    const environment = new FakeEnvironment();
    const root = new RootStore({
      signedIn: false,
      profile: null,
      socketUrl: "wss://game.test/ws",
      tickets: async () => "t".repeat(40),
      createSocket: (url) => new FakeSocket(url),
      profileSource: { fetchProfile: async () => null },
      shopApi: {
        startCheckout: vi.fn(),
        equip: vi.fn(),
        fetchProfile: vi.fn(),
      },
      statsApi: { leaderboard: vi.fn(), matches: vi.fn() },
      navigate: vi.fn(),
      environment,
    });
    root.start();
    await settle();
    expect(FakeSocket.instances).toHaveLength(0);
    root.dispose();
  });
});
