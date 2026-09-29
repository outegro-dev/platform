import {
  classicRules,
  Match,
  MatchError,
  placementCells,
  RandomPlacement,
  SeededRandom,
  type ShipPlacement,
} from "@outegro/battleship-engine";
import {
  type ClientMessage,
  clientMessageSchema,
  type MatchSnapshot,
  type ServerMessage,
  type ServerMessageType,
  type ServerPayload,
  serverMessageSchema,
} from "@outegro/contracts/battleship";
import type { WebSocketRoute } from "@playwright/test";
import { decodeTicket, type Persona, personas } from "./personas.ts";

type BotLevel = "easy" | "medium" | "hard" | "expert";
type Opponent = MatchSnapshot["opponent"];

/** Scripted answers the test can change: how the "server" behaves. */
export type Script = {
  /** Reply to bot.start with premium_required regardless of the level. */
  refusePremium: boolean;
  /** Delay before the bot's own shots (ms). */
  botDelayMs: number;
  /** Bot shots, in order; after the list it picks the first unknown cell. */
  botShots: { x: number; y: number }[];
  /** Milliseconds before a reconnecting socket gets session.ready. */
  readyDelayMs: number;
  /** Deadline per turn for online modes (ms), null for none. */
  turnMs: number | null;
  /** How long the opponent takes to place a fleet (ms). */
  opponentPlaceDelayMs: number;
  /** Refuse the next shot with this code (it changes nothing, TC-BS-04). */
  rejectNextShot: ServerPayload<"error">["code"] | null;
};

let matchCounter = 0;

/**
 * One player's view of the game server: session, lobby and a match played
 * by the real engine. It survives reconnects (each new socket attaches to
 * it), validates every client message against the contract and sends only
 * messages that parse with serverMessageSchema.
 */
export class FakeGame {
  readonly uid: string;
  readonly persona: Persona;
  readonly received: ClientMessage[] = [];
  readonly violations: string[] = [];
  readonly script: Script = {
    refusePremium: false,
    botDelayMs: 350,
    botShots: [],
    readyDelayMs: 0,
    turnMs: null,
    opponentPlaceDelayMs: 200,
    rejectNextShot: null,
  };
  connections = 0;
  match: Match | null = null;
  matchId: string | null = null;
  mode: "bot" | "quick" | "private" = "bot";
  opponent: Opponent = { kind: "bot", level: "easy" };
  opponentFleet: ShipPlacement[] = [];
  opponentConnected = true;
  queuedSince: string | null = null;
  room: { code: string; expiresAt: string } | null = null;
  deadline: string | null = null;
  finished: ServerPayload<"match.finished"> | null = null;
  private socket: WebSocketRoute | null = null;
  private seq = 0;
  /** Last seq per connection: it must grow within one (a new page starts over). */
  private lastSeq = new WeakMap<WebSocketRoute, number>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private player = { ...personaPlayer("free") };

  constructor(uid: string, persona: Persona) {
    this.uid = uid;
    this.persona = persona;
    this.player = personaPlayer(persona);
  }

  get premium(): boolean {
    return this.player.premium;
  }

  attach(ws: WebSocketRoute): void {
    this.connections++;
    this.socket = ws;
    ws.onMessage((raw) => this.receive(ws, String(raw)));
    ws.onClose(() => {
      if (this.socket === ws) this.socket = null;
    });
    const ready = () => {
      if (this.socket !== ws) return;
      this.send("session.ready", {
        player: this.player,
        activeMatchId: this.match && !this.finished ? this.matchId : null,
        queuedSince: this.queuedSince,
        room: this.room,
        serverTime: new Date().toISOString(),
      });
    };
    if (this.script.readyDelayMs > 0)
      this.later(ready, this.script.readyDelayMs);
    else ready();
  }

  /** Closes the current socket from the "server" (network blip). */
  async drop(code = 1011): Promise<void> {
    const ws = this.socket;
    this.socket = null;
    await ws?.close({ code, reason: "test drop" });
  }

  /** The opponent's connection changes (human matches). */
  presence(connected: boolean, graceMs = 60_000): void {
    this.opponentConnected = connected;
    this.send("opponent.presence", {
      connected,
      graceUntil: connected
        ? null
        : new Date(Date.now() + graceMs).toISOString(),
    });
  }

  /** A grant arrived (purchase): push the new player summary. */
  playerUpdated(
    changes: Partial<ServerPayload<"player.updated">["player"]>,
  ): void {
    this.player = { ...this.player, ...changes };
    this.send("player.updated", { player: this.player });
  }

  /** Cells of every enemy ship, for tests that want to win. */
  enemyCells(): { x: number; y: number }[] {
    return this.opponentFleet.flatMap((ship) =>
      placementCells(ship).map((cell) => ({ x: cell.x, y: cell.y })),
    );
  }

  /** A cell of enemy water that has not been shot yet. */
  emptyCell(): { x: number; y: number } {
    const ships = new Set(this.enemyCells().map((c) => `${c.x},${c.y}`));
    const view = this.match?.viewFor("you").target;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const known = view?.cells[y]?.[x] !== "unknown";
        if (!ships.has(`${x},${y}`) && !known) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  /** Starts a human match directly (as if the queue matched). */
  startHumanMatch(
    opponent: Extract<Opponent, { kind: "human" }>,
    mode: "quick" | "private" = "quick",
  ): void {
    this.newMatch(mode, opponent);
    this.send("queue.matched", { matchId: this.matchId as string });
    this.send("match.state", { match: this.snapshot() });
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  snapshot(): MatchSnapshot {
    const match = this.match;
    if (!match || !this.matchId) throw new Error("no match");
    const view = match.viewFor("you");
    const phase = this.finished ? "finished" : view.phase;
    return {
      matchId: this.matchId,
      mode: this.mode,
      rated: this.mode === "quick",
      phase,
      opponent: this.opponent,
      turn:
        phase === "battle" ? (view.turn as "you" | "opponent" | null) : null,
      deadline: phase === "finished" ? null : this.deadline,
      winner: this.finished ? this.finished.winner : null,
      reason: this.finished ? this.finished.reason : null,
      moves: view.moves,
      yourFleetPlaced: view.yourFleetPlaced,
      opponentFleetPlaced: view.opponentFleetPlaced,
      opponentConnected: this.opponentConnected,
      own: view.own
        ? {
            size: view.own.size,
            ships: view.own.ships.map((ship) => ({
              x: ship.x,
              y: ship.y,
              length: ship.length,
              orientation: ship.orientation,
              hits: ship.hits.map((hit) => ({ ...hit })),
              sunk: ship.sunk,
            })),
            shots: view.own.shots.map((row) => [...row]),
          }
        : null,
      target: view.target
        ? {
            size: view.target.size,
            cells: view.target.cells.map((row) => [...row]),
            sunkShips: view.target.sunkShips.map((ship) => ({ ...ship })),
            remaining: [...view.target.remaining],
          }
        : null,
      opponentFleet: this.finished
        ? this.opponentFleet.map((ship) => ({ ...ship }))
        : null,
    };
  }

  // ─── protocol ────────────────────────────────────────────────────────

  private receive(ws: WebSocketRoute, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.violations.push(`not JSON: ${raw.slice(0, 80)}`);
      return;
    }
    const parsed = clientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.violations.push(`invalid client message: ${raw.slice(0, 120)}`);
      return;
    }
    const message = parsed.data;
    const last = this.lastSeq.get(ws);
    if (last !== undefined && message.seq <= last) {
      this.violations.push(`seq went back: ${last} → ${message.seq}`);
    }
    this.lastSeq.set(ws, message.seq);
    this.received.push(message);
    this.socket = ws;
    this.handle(message);
  }

  private handle(message: ClientMessage): void {
    const ref = message.seq;
    switch (message.type) {
      case "ping":
        this.send("pong", { t: message.payload.t });
        return;
      case "bot.start":
        this.startBot(message.payload.level, ref);
        return;
      case "queue.join":
        if (this.queuedSince) {
          this.error("already_queued", ref);
          return;
        }
        this.queuedSince = new Date().toISOString();
        this.send("queue.joined", { mode: "quick", since: this.queuedSince });
        return;
      case "queue.leave":
        this.queuedSince = null;
        this.send("queue.left", {});
        return;
      case "room.create":
        this.room = {
          code: "K7M2QX",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        };
        this.send("room.created", this.room);
        return;
      case "room.cancel":
        this.room = null;
        this.send("room.cancelled", { reason: "cancelled" });
        return;
      case "room.join":
        if (message.payload.code === "ZZZZZZ") {
          this.error("room_not_found", ref);
          return;
        }
        this.newMatch("private", {
          kind: "human",
          nickname: "Grace O'Malley",
          rating: 1298,
          premium: false,
        });
        this.send("match.state", { match: this.snapshot() });
        return;
      case "fleet.place":
        this.placeFleet(message.payload.ships, ref);
        return;
      case "shot.fire":
        this.fire(message.payload.x, message.payload.y, ref);
        return;
      case "match.resign":
        if (!this.match || this.finished) {
          this.error("no_active_match", ref);
          return;
        }
        this.finish("opponent", "resigned");
        return;
      case "match.sync":
        if (!this.match || this.finished) {
          this.error("no_active_match", ref);
          return;
        }
        this.send("match.state", { match: this.snapshot() });
        return;
    }
  }

  private startBot(level: BotLevel, ref: number): void {
    if (this.match && !this.finished) {
      this.error("already_in_match", ref);
      return;
    }
    const locked = level === "hard" || level === "expert";
    if (this.script.refusePremium || (locked && !this.premiumOnServer())) {
      this.error("premium_required", ref);
      return;
    }
    this.newMatch("bot", { kind: "bot", level });
    this.send("match.state", { match: this.snapshot() });
  }

  /** stale-premium: the profile says Premium, the server's grant is gone. */
  private premiumOnServer(): boolean {
    return this.persona !== "stale-premium" && this.player.premium;
  }

  private newMatch(
    mode: "bot" | "quick" | "private",
    opponent: Opponent,
  ): void {
    matchCounter++;
    this.dispose();
    this.matchId = `00000000-0000-4000-8000-${String(900000 + matchCounter).padStart(12, "0")}`;
    this.mode = mode;
    this.opponent = opponent;
    this.finished = null;
    this.queuedSince = null;
    this.room = null;
    this.opponentConnected = true;
    this.match = new Match(
      this.matchId,
      ["you", "opponent"],
      classicRules,
      "you",
    );
    this.opponentFleet = new RandomPlacement(
      new SeededRandom(matchCounter * 31 + 7),
    ).place(classicRules);
    this.deadline =
      mode === "bot" || this.script.turnMs === null
        ? null
        : this.future(90_000);
  }

  private placeFleet(ships: ShipPlacement[], ref: number): void {
    const match = this.match;
    if (!match || this.finished) {
      this.error("no_active_match", ref);
      return;
    }
    try {
      match.placeFleet("you", ships);
    } catch (failure) {
      if (failure instanceof MatchError) {
        this.error(failure.code as ServerPayload<"error">["code"], ref);
        return;
      }
      throw failure;
    }
    this.send("fleet.placed", { side: "you" });
    this.later(() => {
      match.placeFleet("opponent", this.opponentFleet);
      this.send("fleet.placed", { side: "opponent" });
      this.deadline = this.turnDeadline();
      this.send("match.started", { turn: "you", deadline: this.deadline });
    }, this.script.opponentPlaceDelayMs);
  }

  private fire(x: number, y: number, ref: number): void {
    const match = this.match;
    if (!match || this.finished) {
      this.error("no_active_match", ref);
      return;
    }
    if (this.script.rejectNextShot) {
      const code = this.script.rejectNextShot;
      this.script.rejectNextShot = null;
      this.error(code, ref);
      return;
    }
    let events: ReturnType<Match["fire"]>;
    try {
      events = match.fire("you", x, y);
    } catch (failure) {
      if (failure instanceof MatchError) {
        this.error(failure.code as ServerPayload<"error">["code"], ref);
        return;
      }
      throw failure;
    }
    this.emitShot(events, "you");
  }

  private emitShot(
    events: ReturnType<Match["fire"]>,
    by: "you" | "opponent",
  ): void {
    for (const event of events) {
      if (event.type === "shot") {
        this.deadline = event.nextTurn ? this.turnDeadline() : null;
        this.send("shot.result", {
          by,
          x: event.report.x,
          y: event.report.y,
          outcome: event.report.outcome,
          ...(event.report.ship ? { ship: event.report.ship } : {}),
          revealed: event.report.revealed.map((cell) => ({ ...cell })),
          nextTurn: event.nextTurn as "you" | "opponent" | null,
          deadline: this.deadline,
        });
      } else if (event.type === "finished") {
        this.finish(event.winner as "you" | "opponent", event.reason);
        return;
      }
    }
    if (this.match?.currentTurn === "opponent" && !this.finished) {
      this.later(() => this.botTurn(), this.script.botDelayMs);
    }
  }

  private botTurn(): void {
    const match = this.match;
    if (!match || this.finished || match.currentTurn !== "opponent") return;
    const view = match.viewFor("opponent").target;
    let cell = this.script.botShots.shift();
    while (cell && view?.cells[cell.y]?.[cell.x] !== "unknown")
      cell = this.script.botShots.shift();
    if (!cell) {
      outer: for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          if (view?.cells[y]?.[x] === "unknown") {
            cell = { x, y };
            break outer;
          }
        }
      }
    }
    if (!cell) return;
    this.emitShot(match.fire("opponent", cell.x, cell.y), "opponent");
  }

  private finish(
    winner: "you" | "opponent",
    reason: ServerPayload<"match.finished">["reason"],
  ): void {
    const rated = this.mode === "quick";
    const delta = winner === "you" ? 16 : -16;
    this.finished = {
      winner,
      reason,
      rating: rated
        ? {
            before: this.player.rating,
            after: this.player.rating + delta,
            delta,
          }
        : null,
      opponentFleet: this.opponentFleet.map((ship) => ({ ...ship })),
    };
    if (rated)
      this.player = { ...this.player, rating: this.player.rating + delta };
    this.deadline = null;
    this.send("match.finished", this.finished);
  }

  private turnDeadline(): string | null {
    return this.mode === "bot" || this.script.turnMs === null
      ? null
      : this.future(this.script.turnMs);
  }

  private future(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
  }

  private error(
    code: ServerPayload<"error">["code"],
    ref: number | null,
  ): void {
    this.send("error", { code, ref });
  }

  send<T extends ServerMessageType>(type: T, payload: ServerPayload<T>): void {
    const message = { type, seq: ++this.seq, payload } as ServerMessage;
    const parsed = serverMessageSchema.safeParse(message);
    if (!parsed.success) {
      throw new Error(
        `fake server built an invalid ${type}: ${parsed.error.message}`,
      );
    }
    this.socket?.send(JSON.stringify(parsed.data));
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }
}

function personaPlayer(
  persona: Persona,
): ServerPayload<"session.ready">["player"] {
  const base = personas[persona];
  const features = new Set(base.features);
  const premium = features.has("premium");
  const unlocked = (feature: string) => premium || features.has(feature);
  return {
    nickname: base.nickname,
    rating: base.rating,
    premium,
    cosmetics: {
      ships:
        base.equipped.ships === "silver" && unlocked("cosmetics.silver-fleet")
          ? "silver"
          : "classic",
      hitEffect:
        base.equipped.hitEffect === "shards" &&
        unlocked("cosmetics.silver-fleet")
          ? "shards"
          : "flame",
      theme:
        base.equipped.theme === "night-sea" &&
        unlocked("cosmetics.silver-fleet")
          ? "night-sea"
          : "day",
    },
  };
}

/** Routes the page's game socket to fake games, one per signed-in user. */
export class GameHarness {
  readonly games = new Map<string, FakeGame>();
  last: FakeGame | null = null;
  private waiters: ((game: FakeGame) => void)[] = [];
  /** Applied to every game when it is created. */
  defaults: Partial<Script> = {};

  connect(ws: WebSocketRoute): void {
    const ticket = new URL(ws.url()).searchParams.get("ticket") ?? "";
    const claims = decodeTicket(ticket);
    if (!claims) {
      void ws.close({ code: 4401, reason: "bad ticket" });
      return;
    }
    let game = this.games.get(claims.uid);
    if (!game) {
      game = new FakeGame(claims.uid, claims.persona);
      Object.assign(game.script, this.defaults);
      this.games.set(claims.uid, game);
    }
    this.last = game;
    game.attach(ws);
    for (const waiter of this.waiters.splice(0)) waiter(game);
  }

  /** The game of the user who connected last (waits for the first connection). */
  async current(timeoutMs = 10_000): Promise<FakeGame> {
    if (this.last) return this.last;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no game socket connected")),
        timeoutMs,
      );
      this.waiters.push((game) => {
        clearTimeout(timer);
        resolve(game);
      });
    });
  }

  violations(): string[] {
    return [...this.games.values()].flatMap((game) => game.violations);
  }

  dispose(): void {
    for (const game of this.games.values()) game.dispose();
  }
}
