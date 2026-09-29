import { Inject, Injectable } from "@nestjs/common";
import { VALKEY } from "@outegro/nest-common";
import type { Redis } from "ioredis";
import type { QueueEntry } from "../domain/matchmaking.js";

/** The keys expire if nobody touches the queue; every pass refreshes them. */
const QUEUE_TTL_MS = 60 * 60_000;
// The client prefixes keys with "battleship:" (shared Valkey).
const RATING = "mm:rating";
const SINCE = "mm:since";

/** KEYS: rating, since. ARGV: userId, rating, since, ttlMs. 1 if joined, 0 if queued already. */
const JOIN = `
if redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`;

/** KEYS: rating, since. ARGV: ttlMs. Flat [userId, rating, since, ...], one consistent read. */
const SNAPSHOT = `
local out = {}
local waiting = redis.call('ZRANGE', KEYS[2], 0, -1, 'WITHSCORES')
for i = 1, #waiting, 2 do
  local rating = redis.call('ZSCORE', KEYS[1], waiting[i])
  if rating then
    out[#out + 1] = waiting[i]
    out[#out + 1] = rating
    out[#out + 1] = waiting[i + 1]
  end
end
if #waiting > 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  redis.call('PEXPIRE', KEYS[2], ARGV[1])
end
return out
`;

/**
 * KEYS: rating, since. ARGV: a1, b1, a2, b2, ... Claims each pair only if both
 * players are still waiting, removing them in the same atomic step, so no
 * player is ever matched twice even when passes race.
 */
const CLAIM = `
local claimed = {}
for i = 1, #ARGV, 2 do
  local a, b = ARGV[i], ARGV[i + 1]
  if redis.call('ZSCORE', KEYS[2], a) and redis.call('ZSCORE', KEYS[2], b) then
    redis.call('ZREM', KEYS[1], a, b)
    redis.call('ZREM', KEYS[2], a, b)
    claimed[#claimed + 1] = a
    claimed[#claimed + 1] = b
  end
end
return claimed
`;

/** Quick-match queue in Valkey: sorted sets by rating and by waiting time. */
@Injectable()
export class QueueStore {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async join(entry: QueueEntry): Promise<boolean> {
    const joined = await this.valkey.eval(
      JOIN,
      2,
      RATING,
      SINCE,
      entry.userId,
      entry.rating,
      entry.since,
      QUEUE_TTL_MS,
    );
    return joined === 1;
  }

  /** Puts players back with their original waiting time (a pairing fell through). */
  async requeue(entries: readonly QueueEntry[]) {
    for (const entry of entries) await this.join(entry);
  }

  async leave(userId: string): Promise<boolean> {
    const [, removed] = await Promise.all([
      this.valkey.zrem(RATING, userId),
      this.valkey.zrem(SINCE, userId),
    ]);
    return removed === 1;
  }

  /** When the player joined (epoch ms), or null when not queued. */
  async since(userId: string): Promise<number | null> {
    const score = await this.valkey.zscore(SINCE, userId);
    return score === null ? null : Number(score);
  }

  async entries(): Promise<QueueEntry[]> {
    const flat = (await this.valkey.eval(
      SNAPSHOT,
      2,
      RATING,
      SINCE,
      QUEUE_TTL_MS,
    )) as string[];
    const entries: QueueEntry[] = [];
    for (let i = 0; i + 2 < flat.length; i += 3) {
      entries.push({
        userId: flat[i] as string,
        rating: Number(flat[i + 1]),
        since: Number(flat[i + 2]),
      });
    }
    return entries;
  }

  /** The pairs that were still intact, in the order given. */
  async claim(
    pairs: readonly (readonly [QueueEntry, QueueEntry])[],
  ): Promise<[QueueEntry, QueueEntry][]> {
    if (pairs.length === 0) return [];
    const claimed = (await this.valkey.eval(
      CLAIM,
      2,
      RATING,
      SINCE,
      ...pairs.flatMap(([a, b]) => [a.userId, b.userId]),
    )) as string[];
    const ids = new Set(claimed);
    return pairs
      .filter(([a, b]) => ids.has(a.userId) && ids.has(b.userId))
      .map(([a, b]) => [a, b]);
  }

  async size(): Promise<number> {
    return this.valkey.zcard(SINCE);
  }

  /** Queue membership belongs to sockets of this process: cleared on start. */
  async clear() {
    await this.valkey.del(RATING, SINCE);
  }
}
