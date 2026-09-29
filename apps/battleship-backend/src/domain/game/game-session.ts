import type {
  Match,
  MatchEvent,
  MatchPhase,
  Random,
  ShipPlacement,
} from "@outegro/battleship-engine";
import { GameError } from "../errors.js";
import type { Clock, LogPort } from "../ports.js";
import type { Scheduler, TimerHandle } from "../scheduler.js";
import { BotPlayer } from "./bot-player.js";
import { SideProjector } from "./projector.js";
import {
  applyAction,
  playerIdOf,
  replay,
  sideOfPlayer,
  sideOfUser,
  userIdOf,
} from "./seats.js";
import {
  type AbortReason,
  type AuditEntry,
  BOT_ID,
  type FinishResult,
  type GameTimings,
  type MatchAction,
  type MatchRecord,
  type MatchStore,
  type Outgoing,
  otherSide,
  type SessionEnd,
  type SessionOutlet,
  SIDES,
  type SideKey,
  type StoredMove,
} from "./types.js";

export type SessionDeps = {
  readonly store: MatchStore;
  readonly outlet: SessionOutlet;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly random: Random;
  readonly timings: GameTimings;
  readonly log: LogPort;
  /** Called once, after the match finished or was aborted and was stored. */
  readonly onEnd: (session: GameSession, end: SessionEnd) => void;
};

/** Live state for the admin console (server-side only). */
export type SessionInspection = {
  readonly phase: MatchPhase;
  readonly turn: SideKey | null;
  readonly deadline: string | null;
  readonly graceUntil: Partial<Record<SideKey, string>>;
  readonly connected: Partial<Record<SideKey, boolean>>;
};

type Finished = Extract<MatchEvent, { type: "finished" }>;

/**
 * One live match: the engine's Match plus clocks, persistence and delivery.
 *
 * Every change runs one at a time through `run` (commands, timers and the
 * bot never interleave). A change is applied to the engine, stored, and only
 * then broadcast; if storing fails, the engine state is rebuilt from the
 * action log, so a failure changes nothing either.
 */
export class GameSession {
  private match: Match;
  private readonly actions: MatchAction[];
  private readonly projector: SideProjector;
  private readonly bot: BotPlayer | null;
  private deadline: Date | null = null;
  private clockTimer: TimerHandle | null = null;
  private clockToken = 0;
  private idleTimer: TimerHandle | null = null;
  private botTimer: TimerHandle | null = null;
  private botToken = 0;
  private readonly grace = new Map<
    SideKey,
    { until: Date; timer: TimerHandle }
  >();
  private readonly retries = new Set<TimerHandle>();
  private chain: Promise<unknown> = Promise.resolve();
  private ended = false;

  constructor(
    readonly record: MatchRecord,
    private readonly deps: SessionDeps,
    history: readonly MatchAction[] = [],
  ) {
    this.actions = [...history];
    this.match = replay(record, this.actions);
    this.projector = new SideProjector(record);
    const botSeat = SIDES.map((side) => record.seats[side]).find(
      (seat) => seat.kind === "bot",
    );
    this.bot = botSeat
      ? BotPlayer.create(botSeat.level, deps.random, {
          minMs: deps.timings.botThinkMinMs,
          maxMs: deps.timings.botThinkMaxMs,
        })
      : null;
  }

  get id(): string {
    return this.record.id;
  }

  get live(): boolean {
    return !this.ended;
  }

  /** Human participants. */
  get userIds(): string[] {
    return SIDES.map((side) => userIdOf(this.record, side)).filter(
      (id): id is string => id !== null,
    );
  }

  /** Online matches run the placement and turn clocks and the reconnect grace. */
  private get online(): boolean {
    return this.bot === null;
  }

  /** Arms the clocks of a new or recovered match. */
  start(): void {
    const now = this.deps.clock.now().getTime();
    if (this.online) {
      if (this.match.currentPhase === "placement") {
        this.armClock(new Date(now + this.deps.timings.placementMs), (token) =>
          this.onPlacementTimeout(token),
        );
      } else if (this.match.currentPhase === "battle") {
        this.armTurnClock();
      }
      // Nobody is told yet: `stateFor` reports an absent opponent after the snapshot.
      for (const side of SIDES) {
        const userId = userIdOf(this.record, side);
        if (userId && !this.deps.outlet.isOnline(userId))
          this.beginGrace(side, false);
      }
    } else {
      this.armIdle();
      this.armBot();
    }
  }

  // Commands of the players

  placeFleet(userId: string, ships: readonly ShipPlacement[]): Promise<void> {
    return this.run(() =>
      this.act({ kind: "place", side: this.sideOf(userId), ships }, true),
    );
  }

  fire(userId: string, x: number, y: number): Promise<void> {
    return this.run(() =>
      this.act({ kind: "shot", side: this.sideOf(userId), x, y }, true),
    );
  }

  resign(userId: string): Promise<void> {
    return this.run(() =>
      this.act({ kind: "resign", side: this.sideOf(userId) }, true),
    );
  }

  /** The account was suspended or deleted: the match is forfeited. */
  forfeit(userId: string): Promise<void> {
    return this.run(() =>
      this.act({ kind: "abandon", side: this.sideOf(userId) }, false),
    );
  }

  /** Stops the match without a result or rating change (moderation). */
  abort(reason: AbortReason, audit: AuditEntry | null): Promise<void> {
    return this.run(() => this.abortNow(reason, audit));
  }

  /**
   * What a (re)joining player needs, in order with broadcasts: the full
   * snapshot, then the opponent's reconnect deadline when the opponent is away.
   */
  stateFor(userId: string): Promise<Outgoing[]> {
    return this.run(async () => {
      const side = this.sideOf(userId);
      const opponent = otherSide(side);
      const state = this.projector.snapshot(side, this.match, {
        deadline: this.deadline,
        opponentConnected: this.connected(opponent),
        opponentFleet:
          this.match.currentPhase === "finished"
            ? this.fleetOf(opponent)
            : null,
      });
      const away = this.grace.get(opponent);
      return away && !this.ended
        ? [state, this.projector.presence(false, away.until)]
        : [state];
    });
  }

  /** The full snapshot alone. */
  async snapshotFor(userId: string): Promise<Outgoing> {
    const [state] = await this.stateFor(userId);
    if (!state) throw new Error("a snapshot is always produced");
    return state;
  }

  // Presence

  /** The user's last socket closed. */
  userOffline(userId: string): void {
    const side = sideOfUser(this.record, userId);
    if (!side || this.ended || !this.online || this.grace.has(side)) return;
    this.beginGrace(side);
  }

  /** A socket of the user opened again. */
  userOnline(userId: string): void {
    const side = sideOfUser(this.record, userId);
    const entry = side ? this.grace.get(side) : undefined;
    if (!side || !entry) return;
    entry.timer.cancel();
    this.grace.delete(side);
    const opponent = userIdOf(this.record, otherSide(side));
    if (opponent && !this.ended)
      this.deps.outlet.send(opponent, this.projector.presence(true, null));
  }

  inspect(): SessionInspection {
    const graceUntil: Partial<Record<SideKey, string>> = {};
    const connected: Partial<Record<SideKey, boolean>> = {};
    for (const side of SIDES) {
      const entry = this.grace.get(side);
      if (entry) graceUntil[side] = entry.until.toISOString();
      if (userIdOf(this.record, side)) connected[side] = this.connected(side);
    }
    const turn = this.match.currentTurn;
    return {
      phase: this.match.currentPhase,
      turn: turn ? sideOfPlayer(this.record, turn) : null,
      deadline: this.deadline?.toISOString() ?? null,
      graceUntil,
      connected,
    };
  }

  /** Stops every timer for good (shutdown); the stored state stays for recovery. */
  dispose(): void {
    this.ended = true;
    this.disarmAll();
  }

  // Core

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task, task);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private sideOf(userId: string): SideKey {
    const side = sideOfUser(this.record, userId);
    if (!side) throw new GameError("not_a_player");
    return side;
  }

  /**
   * Applies an action through the engine, stores it, re-arms the clocks and
   * broadcasts the result. Rule violations throw before anything changes.
   */
  private async act(action: MatchAction, byHuman: boolean): Promise<void> {
    if (this.ended) throw new GameError("wrong_phase");
    let events: MatchEvent[];
    try {
      events = applyAction(this.match, this.record, action);
    } catch (error) {
      throw GameError.from(error);
    }
    this.actions.push(action);
    const now = this.deps.clock.now();
    const finished = events.find((e): e is Finished => e.type === "finished");
    let result: FinishResult | null = null;
    try {
      if (finished) {
        result = await this.deps.store.finish({
          record: this.record,
          winner: sideOfPlayer(this.record, finished.winner),
          reason: finished.reason,
          moves: this.match.moveCount,
          finalMove: this.storedMove(action, events),
          at: now,
        });
      } else {
        await this.persist(action, events, now);
      }
    } catch (error) {
      this.actions.pop();
      this.match = replay(this.record, this.actions);
      this.deps.log.error(
        {
          matchId: this.id,
          action: action.kind,
          err: (error as Error).message,
        },
        "Could not store a match change; state rolled back",
      );
      throw new GameError("internal");
    }
    if (finished && result) {
      this.conclude(events, finished, result);
      return;
    }
    if (byHuman && this.bot) this.armIdle();
    this.rearm(events);
    this.broadcast(events);
  }

  private persist(action: MatchAction, events: MatchEvent[], at: Date) {
    switch (action.kind) {
      case "place": {
        const started = events.some((e) => e.type === "battle_started");
        return this.deps.store.savePlacement(
          this.id,
          action.side,
          action.ships,
          started ? at : null,
          at,
        );
      }
      case "shot":
      case "skip": {
        const move = this.storedMove(action, events);
        if (!move) throw new Error("a shot or skip must produce a move");
        return this.deps.store.saveMove(this.id, move, at);
      }
      default:
        throw new Error(`${action.kind} always finishes the match`);
    }
  }

  /** The `moves` row of a shot or skip; n counts stored moves, 1-based. */
  private storedMove(
    action: MatchAction,
    events: MatchEvent[],
  ): StoredMove | null {
    if (action.kind !== "shot" && action.kind !== "skip") return null;
    const n = this.actions.filter(
      (a) => a.kind === "shot" || a.kind === "skip",
    ).length;
    if (action.kind === "skip")
      return { n, side: action.side, x: null, y: null, outcome: "skip" };
    const shot = events.find((e) => e.type === "shot");
    if (shot?.type !== "shot") throw new Error("a shot must report");
    return {
      n,
      side: action.side,
      x: action.x,
      y: action.y,
      outcome: shot.report.outcome,
    };
  }

  private broadcast(events: MatchEvent[]) {
    for (const side of SIDES) {
      const userId = userIdOf(this.record, side);
      if (!userId) continue;
      for (const event of events) {
        const message = this.projector.event(side, event, this.deadline);
        if (message) this.deps.outlet.send(userId, message);
      }
    }
  }

  private conclude(
    events: MatchEvent[],
    finished: Finished,
    result: FinishResult,
  ) {
    this.ended = true;
    this.disarmAll();
    const winner = sideOfPlayer(this.record, finished.winner);
    for (const side of SIDES) {
      const userId = userIdOf(this.record, side);
      if (!userId) continue;
      for (const event of events) {
        const message = this.projector.event(side, event, null);
        if (message) this.deps.outlet.send(userId, message);
      }
      this.deps.outlet.send(
        userId,
        this.projector.finished(
          side,
          winner,
          finished.reason,
          result.ratings[side] ?? null,
          this.fleetOf(otherSide(side)),
        ),
      );
    }
    this.deps.onEnd(this, {
      kind: "finished",
      winner,
      reason: finished.reason,
      result,
    });
  }

  private async abortNow(reason: AbortReason, audit: AuditEntry | null) {
    if (this.ended) throw new GameError("wrong_phase");
    await this.deps.store.abort(this.id, reason, this.deps.clock.now(), audit);
    this.ended = true;
    this.disarmAll();
    for (const userId of this.userIds)
      this.deps.outlet.send(userId, {
        type: "match.aborted",
        payload: { reason },
      });
    this.deps.onEnd(this, { kind: "aborted", reason });
  }

  private fleetOf(side: SideKey): readonly ShipPlacement[] {
    const placed = this.actions.find(
      (a) => a.kind === "place" && a.side === side,
    );
    return placed?.kind === "place" ? placed.ships : [];
  }

  private connected(side: SideKey): boolean {
    const userId = userIdOf(this.record, side);
    return userId ? this.deps.outlet.isOnline(userId) : true;
  }

  // Clocks

  private rearm(events: MatchEvent[]) {
    if (this.match.currentPhase !== "battle") return;
    if (!this.online) {
      this.armBot();
      return;
    }
    const turnChanged = events.some(
      (e) =>
        e.type === "battle_started" ||
        e.type === "shot" ||
        e.type === "turn_skipped",
    );
    if (turnChanged) this.armTurnClock();
  }

  private armClock(at: Date, onExpire: (token: number) => Promise<void>) {
    this.clockTimer?.cancel();
    const token = ++this.clockToken;
    this.deadline = at;
    this.clockTimer = this.deps.scheduler.at(at, () => onExpire(token));
  }

  /** A fresh turn clock for whoever is on turn (every shot restarts it). */
  private armTurnClock() {
    const at = new Date(
      this.deps.clock.now().getTime() + this.deps.timings.turnMs,
    );
    this.armClock(at, (token) => this.onTurnTimeout(token));
  }

  private armIdle() {
    this.idleTimer?.cancel();
    this.idleTimer = this.deps.scheduler.after(
      this.deps.timings.botIdleMs,
      () => this.onIdle(),
    );
  }

  private armBot() {
    this.botTimer?.cancel();
    this.botTimer = null;
    if (
      !this.bot ||
      this.ended ||
      this.match.currentPhase !== "battle" ||
      this.match.currentTurn !== BOT_ID
    )
      return;
    const token = ++this.botToken;
    this.botTimer = this.deps.scheduler.after(this.bot.thinkingTime(), () =>
      this.botMove(token),
    );
  }

  private beginGrace(side: SideKey, notify = true) {
    const until = new Date(
      this.deps.clock.now().getTime() + this.deps.timings.graceMs,
    );
    const timer = this.deps.scheduler.at(until, () =>
      this.onGraceExpired(side),
    );
    this.grace.set(side, { until, timer });
    const opponent = userIdOf(this.record, otherSide(side));
    if (opponent && notify)
      this.deps.outlet.send(opponent, this.projector.presence(false, until));
  }

  private disarmAll() {
    this.clockTimer?.cancel();
    this.clockTimer = null;
    this.clockToken++;
    this.deadline = null;
    this.idleTimer?.cancel();
    this.idleTimer = null;
    this.botTimer?.cancel();
    this.botTimer = null;
    this.botToken++;
    for (const { timer } of this.grace.values()) timer.cancel();
    this.grace.clear();
    for (const retry of this.retries) retry.cancel();
    this.retries.clear();
  }

  // Timer actions: stale firings are ignored; a failed store is retried.

  private onPlacementTimeout(token: number): Promise<void> {
    return this.run(async () => {
      if (this.ended || token !== this.clockToken) return;
      const missing = SIDES.filter(
        (side) => !this.match.hasPlacedFleet(playerIdOf(this.record, side)),
      );
      const [only] = missing;
      if (missing.length === 2) await this.abortNow("placement_timeout", null);
      else if (only) await this.act({ kind: "timeout", side: only }, false);
    }).catch((error) =>
      this.retryLater(error, () => this.onPlacementTimeout(token)),
    );
  }

  private onTurnTimeout(token: number): Promise<void> {
    return this.run(async () => {
      if (this.ended || token !== this.clockToken) return;
      const turn = this.match.currentTurn;
      if (!turn) return;
      await this.act(
        { kind: "skip", side: sideOfPlayer(this.record, turn) },
        false,
      );
    }).catch((error) =>
      this.retryLater(error, () => this.onTurnTimeout(token)),
    );
  }

  private onGraceExpired(side: SideKey): Promise<void> {
    return this.run(async () => {
      if (this.ended || !this.grace.has(side)) return;
      await this.act({ kind: "abandon", side }, false);
    }).catch((error) =>
      this.retryLater(error, () => this.onGraceExpired(side)),
    );
  }

  /** Nobody touched a bot match for 15 minutes: the human loses, unrated. */
  private onIdle(): Promise<void> {
    return this.run(async () => {
      const human = SIDES.find((side) => userIdOf(this.record, side));
      if (this.ended || !human) return;
      await this.act({ kind: "abandon", side: human }, false);
    }).catch((error) => this.retryLater(error, () => this.onIdle()));
  }

  private botMove(token: number): Promise<void> {
    return this.run(async () => {
      if (this.ended || !this.bot || token !== this.botToken) return;
      if (this.match.currentTurn !== BOT_ID) return;
      const view = this.match.viewFor(BOT_ID).target;
      if (!view) return;
      const cell = this.bot.chooseShot(view);
      await this.act(
        { kind: "shot", side: sideOfPlayer(this.record, BOT_ID), ...cell },
        false,
      );
    }).catch((error) => this.retryLater(error, () => this.botMove(token)));
  }

  private retryLater(error: unknown, again: () => Promise<void>) {
    if (this.ended) return;
    if (error instanceof GameError && error.code !== "internal") {
      this.deps.log.warn(
        { matchId: this.id, code: error.code },
        "Timer action rejected",
      );
      return;
    }
    const retry = this.deps.scheduler.after(this.deps.timings.retryMs, () => {
      this.retries.delete(retry);
      return again();
    });
    this.retries.add(retry);
  }
}
