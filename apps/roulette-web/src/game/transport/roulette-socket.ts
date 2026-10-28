import {
  type RouletteClientMessage,
  type RouletteServerMessage,
  type RouletteServerPayload,
  rouletteClientMessageSchema,
  rouletteServerMessageSchema,
} from "@outegro/contracts/roulette";
import { Backoff, type BackoffOptions, reconnectBackoff } from "./backoff";
import { Emitter } from "./emitter";
import { realTimers, type Timers } from "./timers";

/**
 * - `connecting`: no session yet, first attempts (the server may be down).
 * - `ready`: `session.ready` received, bets flow.
 * - `reconnecting`: a session was lost, retrying with backoff.
 * - `offline`: the browser reports no network; waits for it to return.
 * - `unauthorized`: a ticket was refused, the sign-in session is over.
 * - `closed`: stopped by the app.
 */
export type SocketStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "offline"
  | "unauthorized"
  | "closed";

/** The part of the browser WebSocket this class uses (a fake in tests). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const SOCKET_OPEN = 1;

/** Getting a ticket failed: the session is over, or the BFF/backend is unreachable. */
export class TicketError extends Error {
  constructor(readonly kind: "unauthorized" | "unavailable") {
    super(`ws ticket: ${kind}`);
  }
}

/** Page visibility and network state (browser events in the app, static in tests). */
export interface Environment {
  visible(): boolean;
  online(): boolean;
  onVisibilityChange(listener: (visible: boolean) => void): () => void;
  onOnlineChange(listener: (online: boolean) => void): () => void;
}

export const staticEnvironment: Environment = {
  visible: () => true,
  online: () => true,
  onVisibilityChange: () => () => {},
  onOnlineChange: () => () => {},
};

export function browserEnvironment(): Environment {
  return {
    visible: () => document.visibilityState !== "hidden",
    online: () => navigator.onLine !== false,
    onVisibilityChange(listener) {
      const handler = () => listener(document.visibilityState !== "hidden");
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
    onOnlineChange(listener) {
      const online = () => listener(true);
      const offline = () => listener(false);
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      return () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
      };
    },
  };
}

type ClientType = RouletteClientMessage["type"];
export type ClientPayload<T extends ClientType> = Extract<
  RouletteClientMessage,
  { type: T }
>["payload"];

export type RouletteSocketEvents = {
  status: SocketStatus;
  /** A session started: the first one, or again after a reconnect. */
  ready: {
    reconnect: boolean;
    session: RouletteServerPayload<"session.ready">;
  };
  /** Every valid inbound message, in order. */
  message: RouletteServerMessage;
  /** A pong: the round trip and the server's time when it answered. */
  pong: { t: number; rtt: number; serverTime: string; receivedAt: number };
  /** An attempt failed; the next one starts at `at` (epoch ms). */
  retry: { attempts: number; at: number };
};

/** Sends messages; the store depends on this, not on the whole socket. */
export interface MessageSender {
  readonly status: SocketStatus;
  send<T extends ClientType>(type: T, payload: ClientPayload<T>): number | null;
  on<K extends keyof RouletteSocketEvents>(
    event: K,
    listener: (payload: RouletteSocketEvents[K]) => void,
  ): () => void;
  start(): void;
  stop(): void;
  retryNow(): void;
}

export type RouletteSocketOptions = {
  /** Endpoint without the ticket, e.g. wss://roulette.outegro.dev/ws. */
  url: string;
  /** A fresh one-time ticket per attempt; throws TicketError. */
  tickets: () => Promise<string>;
  createSocket: (url: string) => SocketLike;
  timers?: Timers;
  random?: () => number;
  environment?: Environment;
  logger?: Pick<Console, "warn">;
  backoff?: BackoffOptions;
  pingIntervalMs?: number;
  /** No pong within this time: the connection is considered dead. */
  pongTimeoutMs?: number;
  /** Socket open but no session.ready within this time: retry. */
  readyTimeoutMs?: number;
};

/**
 * The roulette connection, after Battleship's GameSocket: a one-time ticket
 * per attempt, inbound validation against the contract, typed outbound
 * messages with an increasing `seq`, backoff with jitter, ping/pong with
 * the server's time and a dead-connection watchdog. Unlike Battleship
 * nothing is queued while disconnected: a bet sent after a reconnect could
 * land in another round than the one the player saw.
 */
export class RouletteSocket implements MessageSender {
  private currentStatus: SocketStatus = "idle";
  private socket: SocketLike | null = null;
  private seq = 0;
  private everReady = false;
  /** Bumped whenever a socket or an attempt is abandoned; stale callbacks compare it. */
  private generation = 0;
  private attemptInFlight = false;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private readyTimer: unknown = null;
  private readonly backoff: Backoff;
  private readonly events = new Emitter<RouletteSocketEvents>();
  private readonly timers: Timers;
  private readonly environment: Environment;
  private readonly logger: Pick<Console, "warn">;
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly options: RouletteSocketOptions) {
    this.timers = options.timers ?? realTimers;
    this.environment = options.environment ?? staticEnvironment;
    this.logger = options.logger ?? console;
    this.backoff = new Backoff(
      options.backoff ?? reconnectBackoff,
      options.random ?? Math.random,
    );
  }

  get status(): SocketStatus {
    return this.currentStatus;
  }

  on<K extends keyof RouletteSocketEvents>(
    event: K,
    listener: (payload: RouletteSocketEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  start(): void {
    if (this.currentStatus !== "idle" && this.currentStatus !== "closed")
      return;
    this.unsubscribe = [
      this.environment.onVisibilityChange((visible) =>
        this.handleVisibility(visible),
      ),
      this.environment.onOnlineChange((online) => this.handleOnline(online)),
    ];
    if (!this.environment.online()) {
      this.setStatus("offline");
      return;
    }
    void this.connect();
  }

  stop(): void {
    this.generation++;
    this.attemptInFlight = false;
    this.clearRetry();
    this.stopHeartbeat();
    this.clearReadyTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "client stop");
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.setStatus("closed");
  }

  /**
   * Sends when a session is up. Returns the message's seq, or null when
   * there is no session or the payload breaks the contract (nothing sent).
   */
  send<T extends ClientType>(
    type: T,
    payload: ClientPayload<T>,
  ): number | null {
    if (this.currentStatus !== "ready" || !this.isOpen()) return null;
    const message = { type, seq: this.seq + 1, payload };
    if (!rouletteClientMessageSchema.safeParse(message).success) {
      this.logger.warn("[roulette] outbound message rejected", type);
      return null;
    }
    this.seq = message.seq;
    this.socket?.send(JSON.stringify(message));
    return message.seq;
  }

  /** Try now instead of waiting out the backoff (retry button, tab visible, network back). */
  retryNow(): void {
    if (
      this.currentStatus === "ready" ||
      this.currentStatus === "closed" ||
      this.currentStatus === "idle" ||
      this.attemptInFlight
    )
      return;
    this.clearRetry();
    void this.connect();
  }

  private isOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN;
  }

  private setStatus(status: SocketStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.events.emit("status", status);
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation;
    this.attemptInFlight = true;
    this.setStatus(this.everReady ? "reconnecting" : "connecting");
    let ticket: string;
    try {
      ticket = await this.options.tickets();
    } catch (error) {
      if (generation !== this.generation) return;
      this.attemptInFlight = false;
      if (error instanceof TicketError && error.kind === "unauthorized") {
        this.setStatus("unauthorized");
        return;
      }
      this.scheduleRetry();
      return;
    }
    if (generation !== this.generation) return;
    let socket: SocketLike;
    try {
      socket = this.options.createSocket(
        `${this.options.url}?ticket=${encodeURIComponent(ticket)}`,
      );
    } catch {
      this.attemptInFlight = false;
      this.scheduleRetry();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      if (generation !== this.generation) return;
      this.readyTimer = this.timers.setTimeout(() => {
        this.readyTimer = null;
        if (generation === this.generation) this.abandon("no session.ready");
      }, this.options.readyTimeoutMs ?? 10_000);
    };
    socket.onmessage = (event) => {
      if (generation === this.generation) this.receive(event.data);
    };
    socket.onclose = () => {
      if (generation !== this.generation) return;
      this.socket = null;
      this.attemptInFlight = false;
      this.stopHeartbeat();
      this.clearReadyTimer();
      this.scheduleRetry();
    };
    socket.onerror = () => {
      // A close event always follows; reconnecting is handled there.
    };
  }

  private receive(data: unknown): void {
    let json: unknown;
    try {
      json = JSON.parse(String(data));
    } catch {
      this.logger.warn("[roulette] dropped a message that is not JSON");
      return;
    }
    const parsed = rouletteServerMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        "[roulette] dropped an invalid message",
        parsed.error.issues[0]?.message,
      );
      return;
    }
    const message = parsed.data;
    if (message.type === "pong") {
      this.handlePong(message.payload.t, message.payload.serverTime);
    }
    if (message.type === "session.ready") {
      const reconnect = this.everReady;
      this.everReady = true;
      this.attemptInFlight = false;
      this.clearReadyTimer();
      this.backoff.reset();
      this.currentStatus = "ready";
      this.startHeartbeat();
      this.events.emit("status", "ready");
      this.events.emit("message", message);
      this.events.emit("ready", { reconnect, session: message.payload });
      return;
    }
    this.events.emit("message", message);
  }

  private scheduleRetry(): void {
    this.clearRetry();
    if (!this.environment.online()) {
      this.setStatus("offline");
      return;
    }
    this.setStatus(this.everReady ? "reconnecting" : "connecting");
    const delay = this.backoff.next();
    const at = this.timers.now() + delay;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.events.emit("retry", { attempts: this.backoff.attempts, at });
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) this.timers.clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /** Gives up on the current socket without waiting for its close event. */
  private abandon(reason: string): void {
    this.logger.warn(`[roulette] reconnecting: ${reason}`);
    const socket = this.socket;
    this.generation++;
    this.socket = null;
    this.attemptInFlight = false;
    this.stopHeartbeat();
    this.clearReadyTimer();
    socket?.close(4000, reason);
    this.scheduleRetry();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.ping();
    this.pingTimer = this.timers.setInterval(
      () => this.ping(),
      this.options.pingIntervalMs ?? 15_000,
    );
  }

  private stopHeartbeat(): void {
    if (this.pingTimer !== null) this.timers.clearInterval(this.pingTimer);
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private ping(): void {
    if (this.currentStatus !== "ready" || !this.isOpen()) return;
    this.send("ping", { t: this.timers.now() });
    if (this.pongTimer === null) {
      this.pongTimer = this.timers.setTimeout(() => {
        this.pongTimer = null;
        this.abandon("no pong");
      }, this.options.pongTimeoutMs ?? 10_000);
    }
  }

  private handlePong(t: number, serverTime: string): void {
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pongTimer = null;
    const receivedAt = this.timers.now();
    this.events.emit("pong", {
      t,
      rtt: Math.max(0, receivedAt - t),
      serverTime,
      receivedAt,
    });
  }

  private handleVisibility(visible: boolean): void {
    if (!visible) return;
    // Laptops wake up with sockets that look open but are dead: check at once.
    if (this.currentStatus === "ready") this.ping();
    else this.retryNow();
  }

  private handleOnline(online: boolean): void {
    if (!online) {
      if (this.currentStatus !== "ready" && this.retryTimer !== null) {
        this.clearRetry();
        this.setStatus("offline");
      }
      return;
    }
    if (this.currentStatus === "offline") {
      this.clearRetry();
      void this.connect();
    } else if (this.currentStatus === "ready") {
      this.ping();
    }
  }
}
