import { z } from "zod";
import type { Page } from "../result";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * battleship-backend admin API (`src/admin/admin.controller.ts` on the
 * battleship-backend branch): the only file that knows its paths and
 * response shapes; screens use the normalized views below.
 *
 *   GET  /v1/admin/overview                     battleship.read
 *   GET  /v1/admin/matches?status&mode&userId&cursor&limit
 *   GET  /v1/admin/matches/:id                  both fleets, every move, live state
 *   POST /v1/admin/matches/:id/abort {reason}   battleship.moderate
 *   GET  /v1/admin/players?query&cursor&limit   nickname or userId
 *   GET  /v1/admin/players/:userId              stats, rating history, grants
 *   POST /v1/admin/players/:userId/reset-nickname {reason}
 *   POST /v1/admin/players/:userId/leaderboard {hidden, reason}
 *   GET  /v1/admin/audit?targetType&targetId&cursor&limit
 */

export const matchModes = ["bot", "quick", "private"] as const;
export const matchStatuses = [
  "placement",
  "battle",
  "finished",
  "aborted",
] as const;
export const botLevels = ["easy", "medium", "hard", "expert"] as const;
export type MatchMode = (typeof matchModes)[number];
export type MatchStatus = (typeof matchStatuses)[number];
export type BotLevel = (typeof botLevels)[number];
export type Side = "a" | "b";

const side = z.enum(["a", "b"]);
const botLevel = z.enum(botLevels);
const count = z.number().int().nonnegative();

const shipSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  length: z.number().int().min(1).max(5),
  orientation: z.enum(["horizontal", "vertical"]),
});
export type Ship = z.infer<typeof shipSchema>;

const overviewSchema = z.object({
  socketsOnline: count,
  playersOnline: count,
  activeMatches: z.partialRecord(z.enum(matchModes), count),
  queueSize: count,
  matchesToday: count,
  matches7d: count,
  newPlayers7d: count,
  premiumPlayers: count,
  botWinRate: z.partialRecord(
    botLevel,
    z.object({
      matches: count,
      botWins: count,
      rate: z.number().min(0).max(1).nullable(),
    }),
  ),
});

const human = z.object({
  userId: z.string(),
  nickname: z.string().nullable(),
});
const matchItemSchema = z.object({
  matchId: z.string(),
  mode: z.enum(matchModes),
  status: z.enum(matchStatuses),
  players: z.object({
    a: human,
    b: z.union([human, z.object({ bot: botLevel.nullable() })]),
  }),
  winner: side.nullable(),
  reason: z.string().nullable(),
  abortReason: z.string().nullable().optional(),
  moves: count,
  rated: z.boolean(),
  ratingDelta: z.number().int().nullable(),
  createdAt: z.string(),
  battleStartedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

const moveSchema = z.object({
  n: z.number().int().positive(),
  side,
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  outcome: z.enum(["miss", "hit", "sunk", "skip"]),
  at: z.string(),
});
export type Move = z.infer<typeof moveSchema>;

const matchDetailSchema = matchItemSchema.omit({ moves: true }).extend({
  firstTurn: side,
  fleets: z.object({
    a: z.array(shipSchema).nullable(),
    b: z.array(shipSchema).nullable(),
  }),
  moves: z.array(moveSchema),
  live: z
    .object({
      phase: z.string(),
      turn: side.nullable(),
      deadline: z.string().nullable(),
      graceUntil: z.partialRecord(side, z.string()).default({}),
      connected: z.partialRecord(side, z.boolean()).default({}),
    })
    .nullable(),
});

const playerItemSchema = z.object({
  userId: z.string(),
  nickname: z.string(),
  rating: z.number().int(),
  ratedMatches: count,
  matches: count,
  wins: count,
  losses: count,
  status: z.string(),
  leaderboardHidden: z.boolean(),
  online: z.boolean(),
  createdAt: z.string(),
});

const statsSchema = z.object({
  matches: count,
  wins: count,
  losses: count,
  winRate: z.number().nullable(),
  accuracy: z.number().nullable(),
  currentStreak: count,
  longestStreak: count,
  averageMovesToWin: z.number().nullable(),
  botWins: z.partialRecord(botLevel, count).default({}),
});

const playerDetailSchema = z.object({
  player: playerItemSchema.extend({
    ratedWins: count.optional(),
    currentStreak: count.optional(),
    longestStreak: count.optional(),
    cosmetics: z.record(z.string(), z.string()).optional(),
    activeMatchId: z.string().nullable().optional(),
  }),
  stats: statsSchema.nullable().optional(),
  ratingHistory: z.array(
    z.object({
      matchId: z.string(),
      before: z.number().int(),
      after: z.number().int(),
      delta: z.number().int(),
      at: z.string(),
    }),
  ),
  grants: z.array(
    z.object({
      grantId: z.string(),
      feature: z.string(),
      sourceType: z.string(),
      sourceId: z.string().optional(),
      state: z.string(),
      validFrom: z.string(),
      validUntil: z.string().nullable(),
      active: z.boolean(),
    }),
  ),
});

const auditSchema = z.object({
  id: z.string(),
  actorId: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  reason: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).default({}),
  at: z.string(),
});

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

// Normalized views used by the screens.

export type Participant =
  | { kind: "human"; userId: string; nickname: string | null }
  | { kind: "bot"; level: BotLevel | null };

export type BattleshipOverview = z.infer<typeof overviewSchema>;

export type MatchView = {
  id: string;
  mode: MatchMode;
  status: MatchStatus;
  a: Participant;
  b: Participant;
  winner: Side | null;
  reason: string | null;
  abortReason: string | null;
  moves: number;
  rated: boolean;
  ratingDelta: number | null;
  createdAt: string;
  battleStartedAt: string | null;
  finishedAt: string | null;
};

export type MatchDetail = MatchView & {
  firstTurn: Side;
  fleets: { a: Ship[] | null; b: Ship[] | null };
  history: Move[];
  live: z.infer<typeof matchDetailSchema>["live"];
};

export type PlayerView = z.infer<typeof playerItemSchema>;
export type PlayerDetail = z.infer<typeof playerDetailSchema>;
export type ModerationEntry = {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  data: Record<string, unknown>;
  createdAt: string;
};

export type MatchFilter = {
  status?: MatchStatus;
  mode?: MatchMode;
  userId?: string;
  cursor?: string;
  limit?: number;
};

function toMatch(item: z.infer<typeof matchItemSchema>): MatchView {
  return {
    id: item.matchId,
    mode: item.mode,
    status: item.status,
    a: { kind: "human", ...item.players.a },
    b:
      "bot" in item.players.b
        ? { kind: "bot", level: item.players.b.bot }
        : { kind: "human", ...item.players.b },
    winner: item.winner,
    reason: item.reason,
    abortReason: item.abortReason ?? null,
    moves: item.moves,
    rated: item.rated,
    ratingDelta: item.ratingDelta,
    createdAt: item.createdAt,
    battleStartedAt: item.battleStartedAt,
    finishedAt: item.finishedAt,
  };
}

export class BattleshipAdmin extends OptionalServiceAdapter {
  async overview(): Promise<BattleshipOverview> {
    return parse(
      overviewSchema,
      await this.get("/v1/admin/overview", undefined, { list: true }),
      "battleship overview",
    );
  }

  async matches(filter: MatchFilter): Promise<Page<MatchView>> {
    const result = parse(
      page(matchItemSchema),
      await this.get("/v1/admin/matches", filter, { list: true }),
      "battleship matches",
    );
    return { items: result.items.map(toMatch), nextCursor: result.nextCursor };
  }

  async match(id: string): Promise<MatchDetail> {
    const detail = parse(
      matchDetailSchema,
      await this.get(`/v1/admin/matches/${encodeURIComponent(id)}`),
      "battleship match",
    );
    const { moves: history, fleets, firstTurn, live, ...rest } = detail;
    return {
      ...toMatch({
        ...rest,
        moves: history.filter((move) => move.outcome !== "skip").length,
      }),
      firstTurn,
      fleets,
      history,
      live,
    };
  }

  async abort(matchId: string, reason: string): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/matches/${encodeURIComponent(matchId)}/abort`,
      { reason },
    );
  }

  async players(filter: {
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<PlayerView>> {
    return parse(
      page(playerItemSchema),
      await this.get("/v1/admin/players", filter, { list: true }),
      "battleship players",
    );
  }

  async player(userId: string): Promise<PlayerDetail> {
    return parse(
      playerDetailSchema,
      await this.get(`/v1/admin/players/${encodeURIComponent(userId)}`),
      "battleship player",
    );
  }

  async resetNickname(userId: string, reason: string): Promise<string> {
    const result = await this.send<{ nickname?: string }>(
      "POST",
      `/v1/admin/players/${encodeURIComponent(userId)}/reset-nickname`,
      { reason },
    );
    return result?.nickname ?? "";
  }

  async setLeaderboardHidden(
    userId: string,
    hidden: boolean,
    reason: string,
  ): Promise<void> {
    await this.send(
      "POST",
      `/v1/admin/players/${encodeURIComponent(userId)}/leaderboard`,
      { hidden, reason },
    );
  }

  async audit(filter: {
    targetType?: "match" | "player";
    targetId?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<ModerationEntry>> {
    const result = parse(
      page(auditSchema),
      await this.get("/v1/admin/audit", filter, { list: true }),
      "battleship audit",
    );
    return {
      items: result.items.map(({ at, ...entry }) => ({
        ...entry,
        createdAt: at,
      })),
      nextCursor: result.nextCursor,
    };
  }
}
