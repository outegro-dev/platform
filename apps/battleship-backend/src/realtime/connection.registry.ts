import { Injectable } from "@nestjs/common";
import type { Outgoing, SessionOutlet } from "../domain/game/types.js";
import type { Connection } from "./connection.js";

/**
 * Open sockets by user. A user may have several (tabs): messages go to all of
 * them, and the user is offline only when the last one closes.
 */
@Injectable()
export class ConnectionRegistry implements SessionOutlet {
  private readonly byUser = new Map<string, Set<Connection>>();

  /** Returns true when this is the user's first open socket. */
  add(connection: Connection): boolean {
    const set = this.byUser.get(connection.userId) ?? new Set<Connection>();
    const first = set.size === 0;
    set.add(connection);
    this.byUser.set(connection.userId, set);
    return first;
  }

  /** Returns true when the user has no open socket left. */
  remove(connection: Connection): boolean {
    const set = this.byUser.get(connection.userId);
    if (!set?.delete(connection)) return false;
    if (set.size > 0) return false;
    this.byUser.delete(connection.userId);
    return true;
  }

  send(userId: string, message: Outgoing): void {
    for (const connection of this.byUser.get(userId) ?? [])
      connection.send(message);
  }

  isOnline(userId: string): boolean {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  socketsOf(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  /** Closes every socket of the user (account suspended or deleted). */
  closeUser(userId: string, code: number, reason: string): void {
    for (const connection of [...(this.byUser.get(userId) ?? [])])
      connection.close(code, reason);
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
