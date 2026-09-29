import type { ShipPlacement } from "@outegro/battleship-engine";
import type {
  AbortReason,
  AuditEntry,
  FinishInput,
  FinishResult,
  MatchStore,
  Outgoing,
  SessionOutlet,
  SideKey,
  StoredMove,
} from "../domain/game/types.js";
import type { LogPort } from "../domain/ports.js";
import { RatingPolicy } from "../domain/rating.js";

export const silentLog: LogPort = {
  warn: () => undefined,
  error: () => undefined,
};

/** In-memory MatchStore; `failNext` makes the next write throw. */
export class FakeStore implements MatchStore {
  placements: { side: SideKey; ships: readonly ShipPlacement[] }[] = [];
  moves: StoredMove[] = [];
  waitingForfeits: SideKey[] = [];
  finished: FinishInput[] = [];
  aborted: { reason: AbortReason; audit: AuditEntry | null }[] = [];
  failNext = false;
  private readonly rating = new RatingPolicy();

  private fail() {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("database unavailable");
    }
  }

  async savePlacement(
    _id: string,
    side: SideKey,
    ships: readonly ShipPlacement[],
  ) {
    this.fail();
    this.placements.push({ side, ships });
  }

  async saveMove(_id: string, move: StoredMove) {
    this.fail();
    this.moves.push(move);
  }

  async saveWaitingForfeit(_id: string, side: SideKey) {
    this.fail();
    this.waitingForfeits.push(side);
  }

  async finish(input: FinishInput): Promise<FinishResult> {
    this.fail();
    this.finished.push(input);
    if (input.finalMove) this.moves.push(input.finalMove);
    if (!input.record.rated) return { ratings: {} };
    const loser: SideKey = input.winner === "a" ? "b" : "a";
    const settled = this.rating.settle(
      { rating: 1000, matches: 0 },
      { rating: 1000, matches: 0 },
    );
    return {
      ratings: { [input.winner]: settled.winner, [loser]: settled.loser },
    };
  }

  async abort(
    _id: string,
    reason: AbortReason,
    _at: Date,
    audit: AuditEntry | null,
  ) {
    this.fail();
    this.aborted.push({ reason, audit });
  }
}

/** Collects messages per user; `online` decides presence. */
export class FakeOutlet implements SessionOutlet {
  readonly sent = new Map<string, Outgoing[]>();
  readonly online = new Set<string>();

  send(userId: string, message: Outgoing) {
    const list = this.sent.get(userId) ?? [];
    list.push(message);
    this.sent.set(userId, list);
  }

  isOnline(userId: string) {
    return this.online.has(userId);
  }

  of(userId: string) {
    return this.sent.get(userId) ?? [];
  }

  types(userId: string) {
    return this.of(userId).map((message) => message.type);
  }

  last<T extends Outgoing["type"]>(userId: string, type: T) {
    return this.of(userId)
      .filter(
        (message): message is Extract<Outgoing, { type: T }> =>
          message.type === type,
      )
      .at(-1);
  }

  clear() {
    this.sent.clear();
  }
}
