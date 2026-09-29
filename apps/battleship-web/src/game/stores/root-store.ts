import type {
  Leaderboard,
  PlayerProfile,
  PlayerStats,
} from "@outegro/contracts/battleship";
import { runInAction } from "mobx";
import type { Catalog, Currency } from "@/lib/catalog";
import {
  type Environment,
  GameSocket,
  type SocketLike,
  staticEnvironment,
} from "../transport/game-socket";
import { realTimers, type Timers } from "../transport/timers";
import { AnimationQueue } from "./animation-queue";
import { Clock } from "./clock";
import { LobbyStore } from "./lobby-store";
import { MatchStore } from "./match-store";
import { PlacementStore } from "./placement-store";
import { type KeyValueStorage, PreferencesStore } from "./preferences-store";
import { type ProfileSource, SessionStore } from "./session-store";
import { type ShopApi, ShopStore } from "./shop-store";
import type { SoundPlayer } from "./sound";
import {
  type HistoryPage,
  type Period,
  type StatsApi,
  StatsStore,
} from "./stats-store";

export type RootDeps = {
  signedIn: boolean;
  profile: PlayerProfile | null;
  socketUrl: string;
  tickets: () => Promise<string>;
  createSocket: (url: string) => SocketLike;
  profileSource: ProfileSource;
  shopApi: ShopApi;
  statsApi: StatsApi;
  navigate: (url: string) => void;
  timers?: Timers;
  environment?: Environment;
  storage?: KeyValueStorage | null;
  /** Built from the preferences (it needs to know whether sound is on). */
  createSound?: (preferences: PreferencesStore) => SoundPlayer;
  logger?: Pick<Console, "warn">;
};

/**
 * One per browser tab: the game connection and the long-lived stores, wired
 * together. Page-scoped stores (shop, stats) are created by the pages from
 * the data they rendered on the server, with the root's dependencies.
 * Socket messages fan out to the stores in arrival order; after a reconnect
 * during a match the root asks for a fresh snapshot (`match.sync`).
 */
export class RootStore {
  readonly timers: Timers;
  readonly environment: Environment;
  readonly preferences: PreferencesStore;
  readonly clock: Clock;
  readonly queue: AnimationQueue;
  readonly socket: GameSocket;
  readonly session: SessionStore;
  readonly lobby: LobbyStore;
  readonly placement: PlacementStore;
  readonly match: MatchStore;
  readonly sound: SoundPlayer | undefined;
  private readonly deps: RootDeps;
  private offs: (() => void)[] = [];
  private started = false;

  constructor(deps: RootDeps) {
    this.deps = deps;
    this.timers = deps.timers ?? realTimers;
    this.environment = deps.environment ?? staticEnvironment;
    this.preferences = new PreferencesStore(deps.storage ?? null);
    this.clock = new Clock(this.timers);
    this.queue = new AnimationQueue(this.timers);
    this.socket = new GameSocket({
      url: deps.socketUrl,
      tickets: deps.tickets,
      createSocket: deps.createSocket,
      timers: this.timers,
      environment: this.environment,
      ...(deps.logger ? { logger: deps.logger } : {}),
    });
    this.session = new SessionStore(
      { signedIn: deps.signedIn, profile: deps.profile },
      deps.profileSource,
    );
    this.sound = deps.createSound?.(this.preferences);
    this.lobby = new LobbyStore(this.socket, this.session, this.clock);
    this.placement = new PlacementStore(this.socket);
    this.match = new MatchStore({
      sender: this.socket,
      clock: this.clock,
      queue: this.queue,
      preferences: this.preferences,
      placement: this.placement,
      connection: this.session,
      timers: this.timers,
      ...(this.sound ? { sound: this.sound } : {}),
    });
  }

  /** The shop page's store: catalog from the server render, purchases, cosmetics. */
  createShop(initial: { catalog: Catalog; currency: Currency }): ShopStore {
    return new ShopStore(
      {
        session: this.session,
        api: this.deps.shopApi,
        navigate: this.deps.navigate,
        timers: this.timers,
      },
      initial,
    );
  }

  /** A stats page's store, seeded with what the server rendered. */
  createStats(
    initial: {
      period?: Period;
      board?: Leaderboard | null;
      stats?: PlayerStats | null;
      history?: HistoryPage | null;
    } = {},
  ): StatsStore {
    return new StatsStore(this.deps.statsApi, initial);
  }

  /** Connects when signed in; safe to call more than once. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.wire();
    if (this.session.signedIn) this.socket.start();
  }

  dispose(): void {
    this.started = false;
    for (const off of this.offs) off();
    this.offs = [];
    this.socket.stop();
    this.queue.clear();
  }

  /** The server render saw a different session (signed in or out meanwhile). */
  setSession(signedIn: boolean, profile: PlayerProfile | null): void {
    const was = this.session.signedIn;
    this.session.setSignedIn(signedIn, profile);
    if (!this.started) return;
    if (signedIn && !was) this.socket.start();
    if (!signedIn && was) this.socket.stop();
  }

  private wire(): void {
    const { socket, session, lobby, placement, match, clock } = this;
    this.offs.push(
      socket.on("status", (status) =>
        runInAction(() =>
          session.setConnection(status, socket.attempts, socket.nextRetryAt),
        ),
      ),
      socket.on("retry", ({ attempts, at }) =>
        runInAction(() => session.setConnection(socket.status, attempts, at)),
      ),
      socket.on("rtt", (rtt) => runInAction(() => session.setRtt(rtt))),
      socket.on("message", (message) =>
        runInAction(() => {
          session.handle(message);
          lobby.handle(message);
          placement.handle(message);
          match.handle(message);
        }),
      ),
      socket.on("ready", ({ reconnect, session: ready }) =>
        runInAction(() => {
          clock.sync(ready.serverTime);
          if (ready.activeMatchId) {
            // Back in a match (or a new tab joining it): take a full snapshot.
            if (reconnect || match.matchId !== ready.activeMatchId)
              match.sync();
          } else if (match.active) {
            match.markEndedWhileAway();
          }
        }),
      ),
      this.environment.onVisibilityChange((visible) =>
        runInAction(() => {
          this.preferences.setHidden(!visible);
          // Nobody watches a hidden tab: land queued events at once.
          if (!visible) this.queue.flush();
        }),
      ),
    );
    this.preferences.setHidden(!this.environment.visible());
  }
}
