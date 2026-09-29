import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock, VALKEY } from "@outegro/nest-common";
import type { Redis } from "ioredis";

export const TICKET_TTL_MS = 30_000;
const TICKET = /^[A-Za-z0-9_-]{32,128}$/;

// Only a hash is stored; the client prefixes keys with "battleship:".
const keyOf = (ticket: string) =>
  `ws-ticket:${createHash("sha256").update(ticket).digest("base64url")}`;

/**
 * Single-use tickets for opening the game socket (§16.6): issued to the BFF
 * against an access token, valid 30 seconds, consumed atomically (GETDEL).
 */
@Injectable()
export class TicketStore {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async issue(userId: string): Promise<{ ticket: string; expiresAt: string }> {
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.clock.now().getTime() + TICKET_TTL_MS);
    await this.valkey.set(
      keyOf(ticket),
      JSON.stringify({ userId, expiresAt: expiresAt.toISOString() }),
      "PX",
      TICKET_TTL_MS,
    );
    return { ticket, expiresAt: expiresAt.toISOString() };
  }

  /** The user of a valid ticket; the ticket is gone afterwards either way. */
  async consume(ticket: string | null): Promise<string | null> {
    if (!ticket || !TICKET.test(ticket)) return null;
    const stored = await this.valkey.getdel(keyOf(ticket));
    if (!stored) return null;
    const { userId, expiresAt } = JSON.parse(stored) as {
      userId: string;
      expiresAt: string;
    };
    return new Date(expiresAt).getTime() > this.clock.now().getTime()
      ? userId
      : null;
  }
}
