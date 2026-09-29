import {
  type ClientMessage,
  type ClientMessageType,
  clientMessageSchema,
  type ServerMessage,
  type ServerMessageType,
  type ServerPayload,
  serverMessageSchema,
} from "@outegro/contracts/battleship";
import { Backoff, type BackoffOptions, reconnectBackoff } from "./backoff";
import { Emitter } from "./emitter";
import { realTimers, type Timers } from "./timers";

/**
 * - `connecting`: no session yet, first attempts (the server may be down).
 * - `ready`: `session.ready` received, commands flow.
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

export type ClientPayload<T extends ClientMessageType> = Extract<
  ClientMessage,
  { type: T }
>["payload"];

export type GameSocketEvents = {
  status: SocketStatus;
  /** A session started: the first one, or again after a reconnect. */
  ready: { reconnect: boolean; session: ServerPayload<"session.ready"> };
  /** Every valid inbound message, in order. */
  message: ServerMessage;
  rtt: number;
  /** An attempt failed; the next one starts at `at` (epoch ms). */
  retry: { attempts: number; at: number };
};

/** Sends messages; stores depend on this, not on the whole socket. */
export interface MessageSender {
  send<T extends ClientMessageType>(
    type: T,
    payload: ClientPayload<T>,
  ): number | null;
}

export type GameSocketOptions = {
  /** Endpoint without the ticket, e.g. wss://battleship.outegro.dev/ws. */
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
 * The game connection: one-time ticket per attempt, inbound validation
 * against the contract, typed outbound messages with an increasing `seq`,
 * a queue while (re)connecting, backoff with jitter, ping/pong with RTT and
 * a dead-connection watchdog, and reconnects driven by page visibility and
 * network state. Framework-agnostic: stores subscribe to its events.
 */
export class GameSocket implements MessageSender {
  private currentStatus: SocketStatus = "idle";
  private currentRtt: number | null = null;
  private socket: SocketLike | null = null;
  private seq = 0;
  private readonly queue: string[] = [];
  private everReady = false;
  /** Bumped whenever a socket or an attempt is abandoned; stale callbacks compare it. */
  private generation = 0;
  private attemptInFlight = false;
  private retryTimer: unknown = null;
  private pingTimer: unknown = null;
  private pongTimer: unknown = null;
  private readyTimer: unknown = null;
  private retryAt: number | null = null;
  private readonly backoff: Backoff;
  private readonly events = new Emitter<GameSocketEvents>();
  private readonly timers: Timers;
  private readonly environment: Environment;
  private readonly logger: Pick<Console, "warn">;
  private unsubscribe: (() => void)[] = [];

  constructor(private readonly options: GameSocketOptions) {
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

  /** Last round trip of a ping, in ms. */
  get rtt(): number | null {
    return this.currentRtt;
  }

  /** Failed attempts since the last session. */
  get attempts(): number {
    return this.backoff.attempts;
  }

  /** When the next attempt starts (epoch ms), while waiting. */
  get nextRetryAt(): number | null {
    return this.retryAt;
  }

  /** Messages waiting for a session. */
  get queued(): number {
    return this.queue.length;
  }

  on<K extends keyof GameSocketEvents>(
    event: K,
    listener: (payload: GameSocketEvents[K]) => void,
  ): () => void {
    return this.events.on(event, listener);
  }

  /** Subscribes to one message type with its typed payload. */
  onMessage<T extends ServerMessageType>(
    type: T,
    listener: (payload: ServerPayload<T>) => void,
  ): () => void {
    return this.events.on("message", (message) => {
      if (message.type === type) listener(message.payload as ServerPayload<T>);
    });
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
    this.queue.length = 0;
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    this.setStatus("closed");
  }

  /**
   * Sends now when a session is up, otherwise queues until the next
   * `session.ready` (pings are never queued). Returns the message's seq, or
   * null when the payload breaks the contract (nothing is sent).
   */
  send<T extends ClientMessageType>(
    type: T,
    payload: ClientPayload<T>,
  ): number | null {
    const message = { type, seq: this.seq + 1, payload };
    const valid = clientMessageSchema.safeParse(message);
    if (!valid.success) {
      this.logger.warn("[game] outbound message rejected", type);
      return null;
    }
    this.seq = message.seq;
    const text = JSON.stringify(message);
    if (this.currentStatus === "ready" && this.isOpen()) {
      this.socket?.send(text);
    } else if (type !== "ping") {
      this.queue.push(text);
    }
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
    this.retryAt = null;
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
      this.logger.warn("[game] dropped a message that is not JSON");
      return;
    }
    const parsed = serverMessageSchema.safeParse(json);
    if (!parsed.success) {
      const type =
        typeof json === "object" && json && "type" in json
          ? String((json as { type: unknown }).type)
          : "unknown";
      this.logger.warn(
        "[game] dropped an invalid message",
        type,
        parsed.error.issues[0]?.message,
      );
      return;
    }
    const message = parsed.data;
    if (message.type === "pong") {
      this.handlePong(message.payload.t);
    }
    if (message.type === "session.ready") {
      const reconnect = this.everReady;
      this.everReady = true;
      this.attemptInFlight = false;
      this.clearReadyTimer();
      this.backoff.reset();
      // Status first so replies sent from listeners go straight out, but the
      // queue is flushed before anyone hears about it: seq stays in order.
      this.currentStatus = "ready";
      this.flush();
      this.startHeartbeat();
      this.events.emit("status", "ready");
      this.events.emit("message", message);
      this.events.emit("ready", { reconnect, session: message.payload });
      return;
    }
    this.events.emit("message", message);
  }

  private flush(): void {
    while (this.queue.length > 0 && this.isOpen()) {
      this.socket?.send(this.queue.shift() as string);
    }
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
    this.retryAt = at;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.events.emit("retry", { attempts: this.backoff.attempts, at });
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) this.timers.clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /** Gives up on the current socket without waiting for its close event. */
  private abandon(reason: string): void {
    this.logger.warn(`[game] reconnecting: ${reason}`);
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
      this.options.pingIntervalMs ?? 20_000,
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

  private handlePong(t: number): void {
    if (this.pongTimer !== null) this.timers.clearTimeout(this.pongTimer);
    this.pongTimer = null;
    const rtt = Math.max(0, this.timers.now() - t);
    this.currentRtt = rtt;
    this.events.emit("rtt", rtt);
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
