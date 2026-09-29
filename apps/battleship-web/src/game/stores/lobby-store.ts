import {
  type GameErrorCode,
  premiumBotLevels,
  roomCodeSchema,
  type ServerMessage,
} from "@outegro/contracts/battleship";
import { makeAutoObservable } from "mobx";
import type { MessageSender } from "../transport/game-socket";
import type { Clock } from "./clock";
import type { SessionStore } from "./session-store";

export type BotLevel = "easy" | "medium" | "hard" | "expert";
export const botLevels: readonly BotLevel[] = [
  "easy",
  "medium",
  "hard",
  "expert",
];

export type LobbyCommand =
  | "bot"
  | "queue.join"
  | "queue.leave"
  | "room.create"
  | "room.join"
  | "room.cancel";

export type LobbyError = GameErrorCode | "invalid_room_code" | "offline";

type Pending = { command: LobbyCommand; seq: number; level?: BotLevel };

/**
 * Before a match: bot level, the quick-match queue with its elapsed time,
 * and private rooms (create, join by code, cancel). Commands are intents;
 * the lobby changes only when the server answers.
 */
export class LobbyStore {
  selectedLevel: BotLevel = "easy";
  /** Server epoch ms when the search started; null when not queued. */
  queuedSince: number | null = null;
  room: { code: string; expiresAt: string } | null = null;
  pending: Pending | null = null;
  error: LobbyError | null = null;
  /** Why the last room closed, until the next lobby action. */
  roomClosed: "cancelled" | "expired" | null = null;
  /** A match was just found or started from this tab; the UI opens it once. */
  matchRequested = 0;
  /** A room was just created from this tab; the UI opens its page once. */
  roomOpened = 0;

  constructor(
    private readonly sender: MessageSender,
    private readonly session: SessionStore,
    private readonly clock: Clock,
  ) {
    makeAutoObservable<LobbyStore, "sender" | "session" | "clock">(
      this,
      { sender: false, session: false, clock: false },
      { autoBind: true },
    );
  }

  get queued(): boolean {
    return this.queuedSince !== null;
  }

  /** Seconds since the search started, ticking while shown. */
  get queueSeconds(): number {
    return Math.floor((this.clock.msSince(this.queuedSince) ?? 0) / 1000);
  }

  get roomSecondsLeft(): number | null {
    const ms = this.clock.msUntil(this.room?.expiresAt);
    return ms === null ? null : Math.ceil(ms / 1000);
  }

  isBusy(command?: LobbyCommand): boolean {
    return command ? this.pending?.command === command : this.pending !== null;
  }

  /** Hard and expert need Premium (the server enforces it too, TC-BS-08). */
  isLocked(level: BotLevel): boolean {
    return (
      (premiumBotLevels as readonly string[]).includes(level) &&
      !this.session.premium
    );
  }

  selectLevel(level: BotLevel): void {
    this.selectedLevel = level;
    if (this.error === "premium_required") this.error = null;
  }

  /** Returns false when the level is locked (the UI offers Premium instead). */
  startBot(level: BotLevel = this.selectedLevel): boolean {
    this.selectedLevel = level;
    if (this.isLocked(level)) {
      this.error = "premium_required";
      return false;
    }
    this.run("bot", this.sender.send("bot.start", { level }), level);
    return true;
  }

  joinQueue(): void {
    this.run("queue.join", this.sender.send("queue.join", { mode: "quick" }));
  }

  leaveQueue(): void {
    this.run("queue.leave", this.sender.send("queue.leave", {}));
  }

  createRoom(): void {
    this.roomClosed = null;
    this.run("room.create", this.sender.send("room.create", {}));
  }

  /** Accepts codes typed loosely (spaces, lower case). */
  joinRoom(input: string): boolean {
    const code = normalizeRoomCode(input);
    if (!roomCodeSchema.safeParse(code).success) {
      this.error = "invalid_room_code";
      return false;
    }
    this.run("room.join", this.sender.send("room.join", { code }));
    return true;
  }

  cancelRoom(): void {
    this.run("room.cancel", this.sender.send("room.cancel", {}));
  }

  clearError(): void {
    this.error = null;
  }

  handle(message: ServerMessage): void {
    switch (message.type) {
      case "session.ready": {
        const { queuedSince, room } = message.payload;
        this.queuedSince = queuedSince ? Date.parse(queuedSince) : null;
        this.room = room;
        return;
      }
      case "queue.joined":
        this.queuedSince = Date.parse(message.payload.since);
        this.settle("queue.join");
        return;
      case "queue.left":
        this.queuedSince = null;
        this.settle("queue.leave");
        return;
      case "queue.matched":
        this.queuedSince = null;
        this.pending = null;
        this.matchRequested++;
        return;
      case "room.created":
        this.room = message.payload;
        this.roomClosed = null;
        if (this.pending?.command === "room.create") this.roomOpened++;
        this.settle("room.create");
        return;
      case "room.cancelled":
        this.room = null;
        this.roomClosed = message.payload.reason;
        this.settle("room.cancel");
        return;
      case "match.state": {
        const phase = message.payload.match.phase;
        if (phase === "finished") return;
        // Opened by this tab (bot, room, join): the UI follows into the match.
        if (this.pending !== null || this.room !== null) this.matchRequested++;
        this.pending = null;
        this.queuedSince = null;
        this.room = null;
        return;
      }
      case "error":
        if (this.pending && message.payload.ref === this.pending.seq) {
          this.error = message.payload.code;
          this.pending = null;
        }
        return;
      default:
        return;
    }
  }

  private run(command: LobbyCommand, seq: number | null, level?: BotLevel) {
    if (seq === null) {
      this.error = "bad_message";
      return;
    }
    this.error = null;
    this.pending = { command, seq, ...(level ? { level } : {}) };
  }

  private settle(command: LobbyCommand): void {
    if (this.pending?.command === command) this.pending = null;
  }
}

export function normalizeRoomCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}
