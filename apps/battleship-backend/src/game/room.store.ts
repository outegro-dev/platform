import { Inject, Injectable } from "@nestjs/common";
import { VALKEY } from "@outegro/nest-common";
import type { Redis } from "ioredis";

// The client prefixes keys with "battleship:" (shared Valkey).
const roomKey = (code: string) => `room:${code}`;
const ownerKey = (userId: string) => `room-owner:${userId}`;

/**
 * KEYS: room, owner. ARGV: ownerId, code|expiresAt, ttlMs.
 * "owned" if the owner has a room already, "taken" on a code collision.
 */
const CREATE = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 'owned' end
if redis.call('EXISTS', KEYS[1]) == 1 then return 'taken' end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
return 'ok'
`;

/**
 * KEYS: room, owner. ARGV: ownerId, code. Removes the room only if it still
 * belongs to that owner: exactly one joiner (or one cancel) wins.
 */
const TAKE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
local owned = redis.call('GET', KEYS[2])
if owned and string.sub(owned, 1, #ARGV[2]) == ARGV[2] then redis.call('DEL', KEYS[2]) end
return 1
`;

export type Room = { code: string; expiresAt: Date };

/** Private rooms in Valkey: code → owner, owner → code; 10 minutes each. */
@Injectable()
export class RoomStore {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async create(
    ownerId: string,
    code: string,
    expiresAt: Date,
    ttlMs: number,
  ): Promise<"ok" | "owned" | "taken"> {
    return (await this.valkey.eval(
      CREATE,
      2,
      roomKey(code),
      ownerKey(ownerId),
      ownerId,
      `${code}|${expiresAt.getTime()}`,
      ttlMs,
    )) as "ok" | "owned" | "taken";
  }

  ownerOf(code: string): Promise<string | null> {
    return this.valkey.get(roomKey(code));
  }

  async of(ownerId: string): Promise<Room | null> {
    const value = await this.valkey.get(ownerKey(ownerId));
    if (!value) return null;
    const [code, at] = value.split("|");
    return code && at ? { code, expiresAt: new Date(Number(at)) } : null;
  }

  /** Atomically consumes the room of `ownerId` (joined, cancelled or expired). */
  async take(code: string, ownerId: string): Promise<boolean> {
    const taken = await this.valkey.eval(
      TAKE,
      2,
      roomKey(code),
      ownerKey(ownerId),
      ownerId,
      code,
    );
    return taken === 1;
  }
}
