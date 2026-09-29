import type {
  ClientMessage,
  MatchSnapshot,
  PlayerProfile,
  ServerMessage,
  ServerMessageType,
  ServerPayload,
} from "@outegro/contracts/battleship";
import type { Environment, SocketLike } from "../transport/game-socket";

/** A WebSocket stand-in the test drives from the server side. */
export class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;
  onerror: SocketLike["onerror"] = null;
  readonly sent: ClientMessage[] = [];
  closedWith: number | null = null;

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
    this.sent.push(JSON.parse(data) as ClientMessage);
  }

  close(code = 1000): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.onclose?.({ code, reason: "" });
  }

  // Server side

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(message: ServerMessage | string | object): void {
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

  types(): string[] {
    return this.sent.map((message) => message.type);
  }
}

let serverSeq = 0;

/** A valid server message with an increasing seq. */
export function server<T extends ServerMessageType>(
  type: T,
  payload: ServerPayload<T>,
): Extract<ServerMessage, { type: T }> {
  serverSeq++;
  return { type, seq: serverSeq, payload } as Extract<
    ServerMessage,
    { type: T }
  >;
}

export const player = {
  nickname: "Sailor 4821",
  rating: 1016,
  premium: false,
  cosmetics: { ships: "classic", hitEffect: "flame", theme: "day" },
} as const;

export function sessionReady(
  overrides: Partial<ServerPayload<"session.ready">> = {},
) {
  return server("session.ready", {
    player: { ...player, cosmetics: { ...player.cosmetics } },
    activeMatchId: null,
    queuedSince: null,
    room: null,
    serverTime: new Date(Date.now()).toISOString(),
    ...overrides,
  });
}

export const MATCH_ID = "00000000-0000-4000-8000-00000000000a";

const grid = () =>
  Array.from({ length: 10 }, () =>
    Array.from({ length: 10 }, () => "unknown" as const),
  );

export function snapshot(
  overrides: Partial<MatchSnapshot> = {},
): MatchSnapshot {
  return {
    matchId: MATCH_ID,
    mode: "bot",
    rated: false,
    phase: "battle",
    opponent: { kind: "bot", level: "medium" },
    turn: "you",
    deadline: null,
    winner: null,
    reason: null,
    moves: 0,
    yourFleetPlaced: true,
    opponentFleetPlaced: true,
    opponentConnected: true,
    own: {
      size: 10,
      ships: [
        {
          x: 0,
          y: 0,
          length: 4,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 0,
          y: 2,
          length: 3,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 5,
          y: 2,
          length: 3,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 0,
          y: 4,
          length: 2,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 3,
          y: 4,
          length: 2,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 6,
          y: 4,
          length: 2,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 0,
          y: 6,
          length: 1,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 2,
          y: 6,
          length: 1,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 4,
          y: 6,
          length: 1,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
        {
          x: 6,
          y: 6,
          length: 1,
          orientation: "horizontal",
          hits: [],
          sunk: false,
        },
      ],
      shots: grid(),
    },
    target: {
      size: 10,
      cells: grid(),
      sunkShips: [],
      remaining: [4, 3, 3, 2, 2, 2, 1, 1, 1, 1],
    },
    opponentFleet: null,
    ...overrides,
  };
}

/** Visibility and network the test flips by hand. */
export class FakeEnvironment implements Environment {
  isVisible = true;
  isOnline = true;
  private visibility = new Set<(visible: boolean) => void>();
  private network = new Set<(online: boolean) => void>();

  visible(): boolean {
    return this.isVisible;
  }

  online(): boolean {
    return this.isOnline;
  }

  onVisibilityChange(listener: (visible: boolean) => void): () => void {
    this.visibility.add(listener);
    return () => this.visibility.delete(listener);
  }

  onOnlineChange(listener: (online: boolean) => void): () => void {
    this.network.add(listener);
    return () => this.network.delete(listener);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
    for (const listener of this.visibility) listener(visible);
  }

  setOnline(online: boolean): void {
    this.isOnline = online;
    for (const listener of this.network) listener(online);
  }
}

export const profile: PlayerProfile = {
  userId: "00000000-0000-4000-8000-000000000001",
  nickname: "Sailor 4821",
  rating: 1016,
  provisional: true,
  matches: 3,
  wins: 2,
  premium: false,
  premiumUntil: null,
  features: [],
  cosmetics: {
    equipped: { ships: "classic", hitEffect: "flame", theme: "day" },
    effective: { ships: "classic", hitEffect: "flame", theme: "day" },
  },
};
