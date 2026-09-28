import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { VALKEY } from "@outegro/nest-common";
import type { Redis } from "ioredis";

/**
 * Refresh-token rotation in one atomic Valkey script (ADR-004).
 *
 * State per session:
 *   rt:<sid>   hash { cur: sha256(current token) }        TTL = refresh lifetime
 *   rtg:<sid>  "<sha256(previous)>:<current plaintext>"  TTL = grace window
 *
 * Presented token →
 *   == cur                         → OK     rotate: new cur, grace entry for the old token
 *   == previous, grace still alive → RETRY  return the token already issued (two tabs,
 *                                           lost response); no new version is minted
 *   anything else, session alive   → REUSE  delete both keys: the session is burned
 *   no rt:<sid>                    → DEAD   revoked or expired
 *
 * The grace entry holds the current plaintext token for at most the grace
 * window (default 20 s) inside the cluster-only Valkey; it is never logged.
 */
const ROTATE = `
local cur = redis.call('HGET', KEYS[1], 'cur')
if not cur then return { 'DEAD' } end
if cur == ARGV[1] then
  redis.call('HSET', KEYS[1], 'cur', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[5])
  redis.call('SET', KEYS[2], ARGV[1] .. ':' .. ARGV[3], 'PX', ARGV[4])
  return { 'OK', ARGV[3] }
end
local grace = redis.call('GET', KEYS[2])
if grace then
  local sep = string.find(grace, ':', 1, true)
  if string.sub(grace, 1, sep - 1) == ARGV[1] then
    return { 'RETRY', string.sub(grace, sep + 1) }
  end
end
redis.call('DEL', KEYS[1], KEYS[2])
return { 'REUSE' }
`;

export type RotateResult =
  | { result: "OK" | "RETRY"; sessionId: string; token: string }
  | { result: "REUSE" | "DEAD"; sessionId: string | null };

const SESSION_ID = /^[0-9a-f-]{36}$/;

@Injectable()
export class RefreshStore {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  /** Starts a session's refresh family and returns its first token. */
  async issue(sessionId: string, ttlSec: number) {
    const token = mint(sessionId);
    await this.valkey
      .multi()
      .hset(key(sessionId), "cur", hash(token))
      .expire(key(sessionId), ttlSec)
      .exec();
    return token;
  }

  async rotate(
    presented: string,
    options: { ttlSec: number; graceMs: number },
  ): Promise<RotateResult> {
    const sessionId = presented.split(".")[0] ?? "";
    if (!SESSION_ID.test(sessionId)) return { result: "DEAD", sessionId: null };
    const next = mint(sessionId);
    const [result, token] = (await this.valkey.eval(
      ROTATE,
      2,
      key(sessionId),
      graceKey(sessionId),
      hash(presented),
      hash(next),
      next,
      options.graceMs,
      options.ttlSec,
    )) as [RotateResult["result"], string | undefined];
    if ((result === "OK" || result === "RETRY") && token)
      return { result, sessionId, token };
    return { result: result as "REUSE" | "DEAD", sessionId };
  }

  async revoke(sessionIds: string[]) {
    if (sessionIds.length === 0) return;
    await this.valkey.del(
      ...sessionIds.flatMap((sid) => [key(sid), graceKey(sid)]),
    );
  }

  async isAlive(sessionId: string) {
    return (await this.valkey.exists(key(sessionId))) === 1;
  }
}

const key = (sid: string) => `rt:${sid}`;
const graceKey = (sid: string) => `rtg:${sid}`;
/** `<sid>.<256 random bits>`: the prefix locates the family without storing the token. */
const mint = (sid: string) => `${sid}.${randomBytes(32).toString("base64url")}`;
const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
