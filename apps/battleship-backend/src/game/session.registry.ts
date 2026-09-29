import { Injectable } from "@nestjs/common";
import type { GameSession } from "../domain/game/game-session.js";
import type { MatchMode } from "../domain/rating.js";

/**
 * Live matches in this process (single replica, ADR-001): by match and by
 * participant. One live match per user.
 */
@Injectable()
export class SessionRegistry {
  private readonly byId = new Map<string, GameSession>();
  private readonly byUser = new Map<string, GameSession>();

  add(session: GameSession) {
    this.byId.set(session.id, session);
    for (const userId of session.userIds) this.byUser.set(userId, session);
  }

  remove(session: GameSession) {
    this.byId.delete(session.id);
    for (const userId of session.userIds)
      if (this.byUser.get(userId) === session) this.byUser.delete(userId);
  }

  forUser(userId: string): GameSession | undefined {
    return this.byUser.get(userId);
  }

  byMatch(matchId: string): GameSession | undefined {
    return this.byId.get(matchId);
  }

  all(): GameSession[] {
    return [...this.byId.values()];
  }

  countByMode(): Record<MatchMode, number> {
    const counts: Record<MatchMode, number> = { bot: 0, quick: 0, private: 0 };
    for (const session of this.byId.values()) counts[session.record.mode]++;
    return counts;
  }
}
