import { Inject, Injectable } from "@nestjs/common";
import type { BotLevel } from "@outegro/battleship-engine";
import { CLOCK, type Clock } from "@outegro/nest-common";
import { SCHEDULER } from "../common/tokens.js";
import { GameError } from "../domain/errors.js";
import { generateRoomCode } from "../domain/names.js";
import type { Scheduler, TimerHandle } from "../domain/scheduler.js";
import { EntitlementsService } from "../players/entitlements.service.js";
import { PlayersService } from "../players/players.service.js";
import { ConnectionRegistry } from "../realtime/connection.registry.js";
import { GameService } from "./game.service.js";
import { KeyedMutex } from "./keyed-mutex.js";
import { MatchmakerService } from "./matchmaker.service.js";
import { QueueStore } from "./queue.store.js";
import { type Room, RoomStore } from "./room.store.js";

/** Private rooms live 10 minutes. */
export const ROOM_TTL_MS = 10 * 60_000;

/**
 * Everything before a match: the quick queue, bots and private rooms. A user
 * is in at most one of queue, own room or live match; commands of one user
 * run one at a time.
 */
@Injectable()
export class LobbyService {
  private readonly roomTimers = new Map<
    string,
    { code: string; timer: TimerHandle }
  >();

  constructor(
    private readonly queue: QueueStore,
    private readonly rooms: RoomStore,
    private readonly game: GameService,
    private readonly matchmaker: MatchmakerService,
    private readonly players: PlayersService,
    private readonly entitlements: EntitlementsService,
    private readonly registry: ConnectionRegistry,
    private readonly locks: KeyedMutex,
    @Inject(SCHEDULER) private readonly scheduler: Scheduler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Queue and room of a user, for `session.ready`. */
  async state(userId: string) {
    const [since, room] = await Promise.all([
      this.queue.since(userId),
      this.rooms.of(userId),
    ]);
    // After a restart the expiry notice is armed again on the next connect.
    if (room && !this.roomTimers.has(userId)) this.armRoomExpiry(userId, room);
    return {
      queuedSince: since === null ? null : new Date(since).toISOString(),
      room: room
        ? { code: room.code, expiresAt: room.expiresAt.toISOString() }
        : null,
    };
  }

  async joinQueue(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      await this.assertFree(userId);
      const player = await this.players.ensure(userId);
      const since = this.clock.now();
      const joined = await this.queue.join({
        userId,
        rating: player.rating,
        since: since.getTime(),
      });
      if (!joined) throw new GameError("already_queued");
      this.registry.send(userId, {
        type: "queue.joined",
        payload: { mode: "quick", since: since.toISOString() },
      });
    });
    // Outside the lock: pairing takes both players' locks.
    await this.matchmaker.tick();
  }

  async leaveQueue(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      await this.queue.leave(userId);
      this.registry.send(userId, { type: "queue.left", payload: {} });
    });
  }

  /** Hard and expert need Premium, checked here and not only in the UI (TC-BS-08). */
  async startBot(userId: string, level: BotLevel): Promise<void> {
    const entitlements = await this.entitlements.of(userId);
    if (!entitlements.canPlayBot(level))
      throw new GameError("premium_required");
    await this.locks.run([userId], async () => {
      await this.assertFree(userId);
      await this.game.start({ mode: "bot", userId, level });
    });
  }

  async createRoom(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      await this.assertFree(userId);
      const expiresAt = new Date(this.clock.now().getTime() + ROOM_TTL_MS);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateRoomCode();
        const created = await this.rooms.create(
          userId,
          code,
          expiresAt,
          ROOM_TTL_MS,
        );
        if (created === "owned") throw new GameError("already_queued");
        if (created === "taken") continue;
        this.armRoomExpiry(userId, { code, expiresAt });
        this.registry.send(userId, {
          type: "room.created",
          payload: { code, expiresAt: expiresAt.toISOString() },
        });
        return;
      }
      throw new GameError("internal");
    });
  }

  /** Private rooms are unrated; the owner plays side "a". */
  async joinRoom(userId: string, code: string): Promise<void> {
    const ownerId = await this.rooms.ownerOf(code);
    if (!ownerId) throw new GameError("room_not_found");
    if (ownerId === userId) throw new GameError("own_room");
    await this.locks.run([userId, ownerId], async () => {
      await this.assertFree(userId);
      if (this.game.active(ownerId)) throw new GameError("room_not_found");
      if (!(await this.rooms.take(code, ownerId)))
        throw new GameError("room_not_found");
      this.disarmRoomExpiry(ownerId);
      await this.game.start({ mode: "private", a: ownerId, b: userId });
    });
  }

  async cancelRoom(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      const room = await this.rooms.of(userId);
      if (!room || !(await this.rooms.take(room.code, userId)))
        throw new GameError("room_not_found");
      this.disarmRoomExpiry(userId);
      this.registry.send(userId, {
        type: "room.cancelled",
        payload: { reason: "cancelled" },
      });
    });
  }

  /** The last socket closed: leave the quick queue. A room link stays valid. */
  async userOffline(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      await this.queue.leave(userId);
    });
  }

  /** The account is suspended or deleted: no queue, no room. */
  async dropUser(userId: string): Promise<void> {
    await this.locks.run([userId], async () => {
      await this.queue.leave(userId);
      const room = await this.rooms.of(userId);
      if (room) await this.rooms.take(room.code, userId);
      this.disarmRoomExpiry(userId);
    });
  }

  private async assertFree(userId: string) {
    if (this.game.active(userId)) throw new GameError("already_in_match");
    const [since, room] = await Promise.all([
      this.queue.since(userId),
      this.rooms.of(userId),
    ]);
    if (since !== null || room) throw new GameError("already_queued");
  }

  private armRoomExpiry(ownerId: string, room: Room) {
    this.disarmRoomExpiry(ownerId);
    const timer = this.scheduler.at(room.expiresAt, () =>
      this.expireRoom(ownerId, room.code),
    );
    this.roomTimers.set(ownerId, { code: room.code, timer });
  }

  private disarmRoomExpiry(ownerId: string) {
    this.roomTimers.get(ownerId)?.timer.cancel();
    this.roomTimers.delete(ownerId);
  }

  private async expireRoom(ownerId: string, code: string) {
    await this.locks.run([ownerId], async () => {
      const entry = this.roomTimers.get(ownerId);
      if (entry?.code !== code) return;
      this.roomTimers.delete(ownerId);
      await this.rooms.take(code, ownerId);
      this.registry.send(ownerId, {
        type: "room.cancelled",
        payload: { reason: "expired" },
      });
    });
  }
}
