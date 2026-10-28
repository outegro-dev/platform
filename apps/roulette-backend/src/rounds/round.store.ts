import { Inject, Injectable } from "@nestjs/common";
import { VALKEY } from "@outegro/nest-common";
import { type Color, colors } from "@outegro/roulette-engine";
import type { Redis } from "ioredis";

/** Round keys outlive the round by an hour: late confirms and the last snapshot. */
const ROUND_TTL_SECONDS = 3600;
const TOP = 7;
/** A replica's socket count is trusted this long after it reported it. */
const ONLINE_FRESH_MS = 5000;

/**
 * KEYS: round hash, pending set.
 * ARGV: userId, clientBetId, betId, color, exposure, maxBets, payoutLimit, ttl.
 * One call checks the phase, the player's bets in the round and the colour's
 * payout limit, then reserves the place. Closing flips the phase in the same
 * hash, so no bet slips in after the stop.
 */
const RESERVE = `
if redis.call('HGET', KEYS[1], 'phase') ~= 'betting' then return {'round_closed'} end
local dup = 'b:' .. ARGV[1] .. ':' .. ARGV[2]
local existing = redis.call('HGET', KEYS[1], dup)
if existing then return {'duplicate', existing} end
local count = tonumber(redis.call('HGET', KEYS[1], 'n:' .. ARGV[1]) or '0')
if count >= tonumber(ARGV[6]) then return {'too_many_bets'} end
local exposure = tonumber(redis.call('HGET', KEYS[1], 'x:' .. ARGV[4]) or '0')
if exposure + tonumber(ARGV[5]) > tonumber(ARGV[7]) then return {'table_limit'} end
redis.call('HINCRBY', KEYS[1], 'n:' .. ARGV[1], 1)
redis.call('HINCRBY', KEYS[1], 'x:' .. ARGV[4], ARGV[5])
redis.call('HSET', KEYS[1], dup, ARGV[3])
redis.call('SADD', KEYS[2], ARGV[3])
redis.call('EXPIRE', KEYS[2], ARGV[8])
return {'ok'}
`;

/**
 * KEYS: round hash, pending set. ARGV: userId, clientBetId, betId, color, exposure.
 * Gives the place back once; a second release of the same bet changes nothing.
 */
const RELEASE = `
local dup = 'b:' .. ARGV[1] .. ':' .. ARGV[2]
if redis.call('HGET', KEYS[1], dup) == ARGV[3] then
  redis.call('HDEL', KEYS[1], dup)
  redis.call('HINCRBY', KEYS[1], 'n:' .. ARGV[1], -1)
  redis.call('HINCRBY', KEYS[1], 'x:' .. ARGV[4], -tonumber(ARGV[5]))
end
redis.call('SREM', KEYS[2], ARGV[3])
return 1
`;

/**
 * KEYS: round hash, pending set, colour's top zset, lines hash.
 * ARGV: betId, color, amount, line JSON, ttl.
 * A committed bet joins the colour's totals once, however often it is confirmed.
 */
const CONFIRM = `
redis.call('SREM', KEYS[2], ARGV[1])
if redis.call('HSETNX', KEYS[4], ARGV[1], ARGV[4]) == 1 then
  redis.call('HINCRBY', KEYS[1], 's:' .. ARGV[2], ARGV[3])
  redis.call('HINCRBY', KEYS[1], 'c:' .. ARGV[2], 1)
  redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
  redis.call('EXPIRE', KEYS[3], ARGV[5])
  redis.call('EXPIRE', KEYS[4], ARGV[5])
end
return 1
`;

/** KEYS: leader. ARGV: instance id, ttl ms. Takes or extends the lease. */
const LEASE = `
local holder = redis.call('GET', KEYS[1])
if not holder then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
if holder == ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

/** KEYS: leader. ARGV: instance id. Lets the lease go only if it is still ours. */
const RESIGN = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

export type ReserveInput = {
  round: number;
  userId: string;
  clientBetId: string;
  betId: string;
  color: Color;
  exposure: number;
  maxBets: number;
  payoutLimit: number;
};

export type ReserveOutcome =
  | { status: "ok" }
  | { status: "duplicate"; betId: string }
  | { status: "round_closed" | "too_many_bets" | "table_limit" };

export type ColorTotals = {
  count: number;
  sum: number;
  top: { betId: string; nickname: string; amount: number }[];
};

const roundKey = (round: number) => `round:${round}`;
const pendingKey = (round: number) => `round:${round}:pending`;
const topKey = (round: number, color: Color) => `round:${round}:top:${color}`;
const linesKey = (round: number) => `round:${round}:lines`;

/**
 * The live part of a round in Valkey (ADR-012): phase, reservations,
 * unfinished bets, totals and the biggest bets per colour. Postgres stays
 * the record; this is what makes the hot path one round trip.
 */
@Injectable()
export class RoundStore {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  /** A new round takes bets. */
  async open(round: number): Promise<void> {
    await this.valkey
      .multi()
      .hset(roundKey(round), "phase", "betting")
      .expire(roundKey(round), ROUND_TTL_SECONDS)
      .exec();
  }

  /**
   * A new leader resumes a round that still takes bets: the phase comes back
   * if Valkey lost it, but a close already recorded is never undone.
   */
  async ensureBetting(round: number): Promise<void> {
    await this.valkey
      .multi()
      .hsetnx(roundKey(round), "phase", "betting")
      .expire(roundKey(round), ROUND_TTL_SECONDS)
      .exec();
  }

  /** Stops new reservations at once. */
  async lock(round: number): Promise<void> {
    await this.valkey.hset(roundKey(round), "phase", "locked");
  }

  async phase(round: number): Promise<string | null> {
    return this.valkey.hget(roundKey(round), "phase");
  }

  async reserve(input: ReserveInput): Promise<ReserveOutcome> {
    const [status, betId] = (await this.valkey.eval(
      RESERVE,
      2,
      roundKey(input.round),
      pendingKey(input.round),
      input.userId,
      input.clientBetId,
      input.betId,
      input.color,
      input.exposure,
      input.maxBets,
      input.payoutLimit,
      ROUND_TTL_SECONDS,
    )) as [string, string | undefined];
    if (status === "duplicate" && betId) return { status, betId };
    if (status === "ok") return { status };
    return {
      status: status as "round_closed" | "too_many_bets" | "table_limit",
    };
  }

  /** The bet holding a player's place for this clientBetId, if any. */
  async reservedBet(input: {
    round: number;
    userId: string;
    clientBetId: string;
  }): Promise<string | null> {
    return this.valkey.hget(
      roundKey(input.round),
      `b:${input.userId}:${input.clientBetId}`,
    );
  }

  async release(input: {
    round: number;
    userId: string;
    clientBetId: string;
    betId: string;
    color: Color;
    exposure: number;
  }): Promise<void> {
    await this.valkey.eval(
      RELEASE,
      2,
      roundKey(input.round),
      pendingKey(input.round),
      input.userId,
      input.clientBetId,
      input.betId,
      input.color,
      input.exposure,
    );
  }

  async confirm(input: {
    round: number;
    betId: string;
    color: Color;
    amount: number;
    nickname: string;
  }): Promise<void> {
    await this.valkey.eval(
      CONFIRM,
      4,
      roundKey(input.round),
      pendingKey(input.round),
      topKey(input.round, input.color),
      linesKey(input.round),
      input.betId,
      input.color,
      input.amount,
      JSON.stringify({ nickname: input.nickname, amount: input.amount }),
      ROUND_TTL_SECONDS,
    );
  }

  /** Bets reserved and not finished: debits in flight or not yet committed. */
  async pending(round: number): Promise<string[]> {
    return this.valkey.smembers(pendingKey(round));
  }

  async pendingCount(round: number): Promise<number> {
    return this.valkey.scard(pendingKey(round));
  }

  async dropPending(round: number, betIds: string[]): Promise<void> {
    if (betIds.length > 0) await this.valkey.srem(pendingKey(round), ...betIds);
  }

  /** Totals and the seven biggest bets of every colour, for the snapshot. */
  async totals(round: number): Promise<Record<Color, ColorTotals>> {
    const pipeline = this.valkey.pipeline();
    pipeline.hmget(
      roundKey(round),
      ...colors.flatMap((color) => [`s:${color}`, `c:${color}`]),
    );
    for (const color of colors)
      pipeline.zrevrange(topKey(round, color), 0, TOP - 1);
    const results = (await pipeline.exec()) ?? [];
    const sums = (results[0]?.[1] ?? []) as (string | null)[];
    const tops = colors.map((_, i) => (results[i + 1]?.[1] ?? []) as string[]);
    const ids = tops.flat();
    const lines = ids.length
      ? await this.valkey.hmget(linesKey(round), ...ids)
      : [];
    const byId = new Map(
      ids.map((id, i) => [
        id,
        JSON.parse(lines[i] ?? '{"nickname":"","amount":0}') as {
          nickname: string;
          amount: number;
        },
      ]),
    );
    const totals = {} as Record<Color, ColorTotals>;
    colors.forEach((color, i) => {
      totals[color] = {
        sum: Number(sums[i * 2] ?? 0),
        count: Number(sums[i * 2 + 1] ?? 0),
        top: (tops[i] ?? []).map((betId) => ({
          betId,
          nickname: byId.get(betId)?.nickname ?? "",
          amount: byId.get(betId)?.amount ?? 0,
        })),
      };
    });
    return totals;
  }

  /** What each colour of a round would pay if it won now. */
  async exposure(round: number): Promise<Record<Color, number>> {
    const values = await this.valkey.hmget(
      roundKey(round),
      ...colors.map((color) => `x:${color}`),
    );
    return Object.fromEntries(
      colors.map((color, i) => [color, Math.max(0, Number(values[i] ?? 0))]),
    ) as Record<Color, number>;
  }

  /** Every replica reports its open sockets each second. */
  async reportOnline(instanceId: string, sockets: number): Promise<void> {
    await this.valkey
      .multi()
      .hset("online", instanceId, `${sockets}:${Date.now()}`)
      .expire("online", 60)
      .exec();
  }

  /** Open sockets over the replicas that reported in the last few seconds. */
  async online(): Promise<number> {
    const reports = await this.valkey.hgetall("online");
    const fresh = Date.now() - ONLINE_FRESH_MS;
    let total = 0;
    for (const report of Object.values(reports)) {
      const [sockets, at] = report.split(":").map(Number);
      if ((at ?? 0) >= fresh) total += sockets ?? 0;
    }
    return total;
  }

  /** Who holds the engine lease and for how much longer. */
  async leader(): Promise<{ instance: string; leaseMs: number } | null> {
    const [instance, leaseMs] = await Promise.all([
      this.valkey.get("leader"),
      this.valkey.pttl("leader"),
    ]);
    return instance ? { instance, leaseMs: Math.max(0, leaseMs) } : null;
  }

  /** Takes or extends the engine lease; false when another instance holds it. */
  async lease(instanceId: string, ttlMs: number): Promise<boolean> {
    return (
      (await this.valkey.eval(LEASE, 1, "leader", instanceId, ttlMs)) === 1
    );
  }

  async resign(instanceId: string): Promise<void> {
    await this.valkey.eval(RESIGN, 1, "leader", instanceId);
  }
}
