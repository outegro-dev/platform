import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface.js";
import { Redis } from "ioredis";
import { HealthRegistry } from "./health.js";

export const VALKEY = Symbol("VALKEY");

/**
 * Fixed-window counter with an optional block, in one atomic step.
 * KEYS: hits, block. ARGV: windowMs, limit, blockMs.
 * Returns: hits, windowTtlMs, blocked (0/1), blockTtlMs.
 */
const CONSUME = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { tonumber(redis.call('GET', KEYS[1]) or '0'), redis.call('PTTL', KEYS[1]), 1, blockTtl }
end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) and tonumber(ARGV[3]) > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return { hits, ttl, 1, tonumber(ARGV[3]) }
end
return { hits, ttl, 0, 0 }
`;

type ConsumeResult = [
  hits: number,
  ttlMs: number,
  blocked: 0 | 1,
  blockMs: number,
];

async function consume(
  client: Redis,
  key: string,
  windowMs: number,
  limit: number,
  blockMs: number,
) {
  return (await client.eval(
    CONSUME,
    2,
    `${key}:hits`,
    `${key}:block`,
    windowMs,
    limit,
    blockMs,
  )) as ConsumeResult;
}

/**
 * Storage for @nestjs/throttler in Valkey: limits survive deploys and
 * restarts (the default in-memory storage resets them).
 */
@Injectable()
export class ValkeyThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(VALKEY) private readonly client: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const [hits, ttlMs, blocked, blockMs] = await consume(
      this.client,
      `rl:${throttlerName}:${key}`,
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    );
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blocked === 1 || hits > limit,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}

/**
 * Business limits outside HTTP routing (login code attempts, resend
 * cooldown, per-email budgets): `consume("login:email:<hash>", 5, 10 min)`.
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(VALKEY) private readonly client: Redis) {}

  async consume(key: string, limit: number, windowMs: number) {
    const [hits, ttlMs] = await consume(
      this.client,
      `bl:${key}`,
      windowMs,
      limit,
      0,
    );
    return {
      allowed: hits <= limit,
      remaining: Math.max(0, limit - hits),
      retryAfterMs: hits <= limit ? 0 : Math.max(0, ttlMs),
    };
  }

  async reset(key: string) {
    await this.client.del(`bl:${key}:hits`, `bl:${key}:block`);
  }
}

@Injectable()
class ValkeyLifecycle implements OnModuleInit, OnApplicationShutdown {
  constructor(
    @Inject(VALKEY) private readonly client: Redis,
    private readonly health: HealthRegistry,
  ) {}
  onModuleInit() {
    this.health.register("valkey", async () => {
      if ((await this.client.ping()) !== "PONG")
        throw new Error("unexpected ping reply");
    });
  }
  async onApplicationShutdown() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}

@Global()
@Module({})
export class ValkeyModule {
  static forRootAsync(options: {
    inject?: (string | symbol | (abstract new (...args: never[]) => unknown))[];
    useFactory: (...args: never[]) => string;
  }): DynamicModule {
    return {
      module: ValkeyModule,
      providers: [
        {
          provide: VALKEY,
          inject: options.inject ?? [],
          useFactory: (...args: never[]) =>
            new Redis(options.useFactory(...args), {
              maxRetriesPerRequest: 2,
              enableAutoPipelining: true,
              connectionName: "outegro",
            }),
        },
        ValkeyLifecycle,
        ValkeyThrottlerStorage,
        RateLimiter,
      ],
      exports: [VALKEY, ValkeyThrottlerStorage, RateLimiter],
    };
  }
}
