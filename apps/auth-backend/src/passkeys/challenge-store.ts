import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { VALKEY } from "@outegro/nest-common";
import type { Redis } from "ioredis";
import { z } from "zod";

export type Ceremony = "registration" | "authentication";

const storedSchema = z.object({
  challenge: z.string().min(16),
  /** Registration only: whose ceremony it is, and from which session. */
  userId: z.uuid().optional(),
  sessionId: z.uuid().optional(),
});
export type StoredChallenge = z.infer<typeof storedSchema>;

const ID = /^[0-9a-f-]{36}$/;

/**
 * One-time WebAuthn challenges (ID-05) in Valkey. The browser holds only an
 * opaque id; the challenge itself, and for a registration its user and
 * session, stay here with a TTL. `take` is a single GETDEL: of two
 * verifications racing with one id only one gets the challenge, a used or
 * expired id gets nothing, and nothing is ever deleted after a check.
 */
@Injectable()
export class ChallengeStore {
  constructor(@Inject(VALKEY) private readonly valkey: Redis) {}

  async put(ceremony: Ceremony, value: StoredChallenge, ttlMs: number) {
    const id = randomUUID();
    await this.valkey.set(
      keyOf(ceremony, id),
      JSON.stringify(value),
      "PX",
      ttlMs,
    );
    return id;
  }

  /** The challenge, once; null when unknown, expired or already taken. */
  async take(ceremony: Ceremony, id: string): Promise<StoredChallenge | null> {
    if (!ID.test(id)) return null;
    const raw = await this.valkey.getdel(keyOf(ceremony, id));
    if (!raw) return null;
    const parsed = storedSchema.safeParse(parseJson(raw));
    return parsed.success ? parsed.data : null;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const keyOf = (ceremony: Ceremony, id: string) =>
  `wa:${ceremony === "registration" ? "reg" : "auth"}:${id}`;
