import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startValkey, type TestService } from "./testing.js";
import { RateLimiter, ValkeyThrottlerStorage } from "./valkey.js";

let valkey: TestService;
let client: Redis;

beforeAll(async () => {
  valkey = await startValkey();
  client = new Redis(valkey.url);
});
afterAll(async () => {
  await client?.quit();
  await valkey?.stop();
});

describe("ValkeyThrottlerStorage", () => {
  it("counts hits in a window and blocks once the limit is exceeded", async () => {
    const storage = new ValkeyThrottlerStorage(client);
    const hit = () =>
      storage.increment("ip:1.2.3.4", 60_000, 3, 5_000, "default");
    for (let i = 1; i <= 3; i++) {
      const record = await hit();
      expect(record.totalHits).toBe(i);
      expect(record.isBlocked).toBe(false);
    }
    const blocked = await hit();
    expect(blocked.isBlocked).toBe(true);
    expect(blocked.timeToBlockExpire).toBeGreaterThan(0);
    expect(blocked.timeToBlockExpire).toBeLessThanOrEqual(5);
    // Still blocked on the next request, counter not advanced further.
    expect((await hit()).isBlocked).toBe(true);
  });

  it("keeps counters in Valkey, so a new instance sees the same state", async () => {
    await new ValkeyThrottlerStorage(client).increment(
      "user:a",
      60_000,
      10,
      0,
      "auth",
    );
    const fresh = new ValkeyThrottlerStorage(new Redis(valkey.url));
    expect(
      (await fresh.increment("user:a", 60_000, 10, 0, "auth")).totalHits,
    ).toBe(2);
  });
});

describe("RateLimiter", () => {
  it("allows up to the limit per window and reports when to retry", async () => {
    const limiter = new RateLimiter(client);
    const results = [];
    for (let i = 0; i < 6; i++)
      results.push(await limiter.consume("login:code:c1", 5, 60_000));
    expect(results.slice(0, 5).every((r) => r.allowed)).toBe(true);
    expect(results[5]?.allowed).toBe(false);
    expect(results[5]?.retryAfterMs).toBeGreaterThan(0);
  });

  it("opens a new window after it expires and can be reset", async () => {
    const limiter = new RateLimiter(client);
    expect((await limiter.consume("resend:a", 1, 150)).allowed).toBe(true);
    expect((await limiter.consume("resend:a", 1, 150)).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect((await limiter.consume("resend:a", 1, 150)).allowed).toBe(true);
    await limiter.reset("resend:a");
    expect((await limiter.consume("resend:a", 1, 150)).remaining).toBe(0);
  });
});
