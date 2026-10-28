import { Injectable } from "@nestjs/common";
import type { OwnBet } from "@outegro/contracts/roulette";
import type { Connection, Outgoing } from "./connection.js";

/**
 * Open sockets by user, and each user's bets in the current round, so the
 * payout of a settled round reaches exactly the players who bet in it. A
 * user may have several sockets (tabs): personal messages go to all of them.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly byUser = new Map<string, Set<Connection>>();
  private readonly betsByUser = new Map<string, OwnBet[]>();

  add(connection: Connection): void {
    const set = this.byUser.get(connection.userId) ?? new Set<Connection>();
    set.add(connection);
    this.byUser.set(connection.userId, set);
  }

  remove(connection: Connection): void {
    const set = this.byUser.get(connection.userId);
    if (!set?.delete(connection) || set.size > 0) return;
    this.byUser.delete(connection.userId);
    this.betsByUser.delete(connection.userId);
  }

  send(userId: string, message: Outgoing): void {
    for (const connection of this.byUser.get(userId) ?? [])
      connection.send(message);
  }

  /** The same serialized frame to every socket. */
  broadcast(frame: string): void {
    for (const connection of this.connections()) connection.sendFrame(frame);
  }

  connectionsOf(userId: string): Iterable<Connection> {
    return this.byUser.get(userId) ?? [];
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  socketsOf(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Remembers an accepted bet of an online player (once per bet). */
  track(userId: string, bet: OwnBet): void {
    if (!this.isOnline(userId)) return;
    const list = (this.betsByUser.get(userId) ?? []).filter(
      (known) => known.round === bet.round,
    );
    if (!list.some((known) => known.betId === bet.betId)) list.push(bet);
    this.betsByUser.set(userId, list);
  }

  /** Takes the tracked bets of a round: who to tell about its payout. */
  takeBetsOf(round: number): Map<string, OwnBet[]> {
    const result = new Map<string, OwnBet[]>();
    for (const [userId, list] of this.betsByUser) {
      const inRound = list.filter((bet) => bet.round === round);
      if (inRound.length === 0) continue;
      result.set(userId, inRound);
      this.betsByUser.set(
        userId,
        list.filter((bet) => bet.round !== round),
      );
    }
    return result;
  }

  *connections(): Iterable<Connection> {
    for (const set of this.byUser.values()) yield* set;
  }

  stats(): { sockets: number; players: number } {
    let sockets = 0;
    for (const set of this.byUser.values()) sockets += set.size;
    return { sockets, players: this.byUser.size };
  }
}
