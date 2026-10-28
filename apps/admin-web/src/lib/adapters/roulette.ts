import {
  type AdminLive,
  type AdminPlayer,
  type AdminRound,
  type AdminRoundDetail,
  type AdminServices,
  adminAuditEntrySchema,
  adminLiveSchema,
  adminPlayerDetailSchema,
  adminPlayersPageSchema,
  adminRoundDetailSchema,
  adminRoundsPageSchema,
  adminServicesSchema,
  type TableSettings,
  tableCommandResultSchema,
  tableSettingsSchema,
  voidResultSchema,
} from "@outegro/contracts/roulette";
import { z } from "zod";
import type { Page } from "../result";
import { auditTargetOf } from "../roulette";
import { OptionalServiceAdapter, parse } from "./base";

/**
 * roulette-backend admin API (roulette.outegro.dev; contract: the admin part
 * of `@outegro/contracts/roulette`): the only file that knows its paths and
 * response shapes. Every call carries the operator's own token; commands are
 * previewed first (`preview: true`), then sent again without it.
 *
 *   GET  /v1/admin/live                          roulette.read
 *   GET  /v1/admin/rounds?cursor&limit           newest first
 *   GET  /v1/admin/rounds/:round                 seeds, the chain link, top bets
 *   POST /v1/admin/rounds/:round/void {reason, preview?}           roulette.void
 *   GET  /v1/admin/players?q&cursor&limit        by turnover
 *   GET  /v1/admin/players/:userId               with the last bets
 *   GET  /v1/admin/table
 *   POST /v1/admin/table {…settings, expectedVersion, reason, preview?}  roulette.manage
 *   GET  /v1/admin/services                      health, engine leader, wallet mode
 *   GET  /v1/admin/audit?cursor                  table changes and voided rounds
 *
 * Refusals: 409 VERSION_CONFLICT (the table changed meanwhile), 422
 * UNPROCESSABLE (the round is settled or voided already), 409 CONFLICT (the
 * round started paying out meanwhile), 401 (a token older than the actor's
 * last role change), 403 FORBIDDEN, 404 NOT_FOUND.
 */

export type LiveView = AdminLive;
export type RoundView = AdminRound;
export type RoundDetail = AdminRoundDetail;
export type BetView = RoundDetail["topBets"][number];
export type PlayerView = AdminPlayer;
export type PlayerDetail = z.infer<typeof adminPlayerDetailSchema>;
export type ServicesView = AdminServices;
export type { TableSettings };
export type TablePreview = z.infer<typeof tableCommandResultSchema>;
export type VoidPreview = z.infer<typeof voidResultSchema>;

/** What the table form sends: every setting at once, as the contract says. */
export type TableChange = Pick<
  TableSettings,
  | "minBet"
  | "maxBet"
  | "betsPerRound"
  | "payoutLimitPerColor"
  | "paused"
  | "maintenance"
> & { expectedVersion: number; reason: string };

/**
 * Roulette's audit, read tolerantly like Education's: an action newer than
 * the contract is still an entry (the feed shows its code), the rest of the
 * entry is checked as the contract says.
 */
const auditEntrySchema = adminAuditEntrySchema.extend({
  action: z.string().min(1),
});
const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
/**
 * An entry as the console's timelines read it: the subject (`round:184`,
 * `table`) becomes a target the feed can name and link.
 */
export type RouletteAuditEntry = {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  data: Record<string, unknown>;
  createdAt: string;
};

const roundPath = (round: number) => `/v1/admin/rounds/${round}`;

export class RouletteAdmin extends OptionalServiceAdapter {
  async live(): Promise<LiveView> {
    return parse(
      adminLiveSchema,
      await this.get("/v1/admin/live", undefined, { list: true }),
      "roulette live",
    );
  }

  async rounds(filter: {
    cursor?: string;
    limit?: number;
  }): Promise<Page<RoundView>> {
    return parse(
      adminRoundsPageSchema,
      await this.get("/v1/admin/rounds", filter, { list: true }),
      "roulette rounds",
    );
  }

  async round(round: number): Promise<RoundDetail> {
    return parse(
      adminRoundDetailSchema,
      await this.get(roundPath(round)),
      "roulette round",
    );
  }

  /** Cancels a round and returns every bet; with `preview`, only counts them. */
  async voidRound(
    round: number,
    input: { reason: string; preview: boolean },
  ): Promise<VoidPreview> {
    return parse(
      voidResultSchema,
      await this.send("POST", `${roundPath(round)}/void`, {
        reason: input.reason,
        ...(input.preview ? { preview: true } : {}),
      }),
      "roulette void",
    );
  }

  async players(filter: {
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<Page<PlayerView>> {
    return parse(
      adminPlayersPageSchema,
      await this.get("/v1/admin/players", filter, { list: true }),
      "roulette players",
    );
  }

  async player(userId: string): Promise<PlayerDetail> {
    return parse(
      adminPlayerDetailSchema,
      await this.get(`/v1/admin/players/${encodeURIComponent(userId)}`),
      "roulette player",
    );
  }

  async table(): Promise<TableSettings> {
    return parse(
      tableSettingsSchema,
      await this.get("/v1/admin/table", undefined, { list: true }),
      "roulette table",
    );
  }

  /** Limits and switches of the table; with `preview`, the diff only. */
  async setTable(
    input: TableChange & { preview: boolean },
  ): Promise<TablePreview> {
    const { preview, ...body } = input;
    return parse(
      tableCommandResultSchema,
      await this.send("POST", "/v1/admin/table", {
        ...body,
        ...(preview ? { preview: true } : {}),
      }),
      "roulette table command",
    );
  }

  async services(): Promise<ServicesView> {
    return parse(
      adminServicesSchema,
      await this.get("/v1/admin/services", undefined, { list: true }),
      "roulette services",
    );
  }

  /**
   * The roulette commands, newest first. The service pages by its own size;
   * `limit` is sent for the merged timeline and may be ignored.
   */
  async audit(filter: {
    cursor?: string;
    limit?: number;
  }): Promise<Page<RouletteAuditEntry>> {
    const page = parse(
      auditPageSchema,
      await this.get("/v1/admin/audit", filter, { list: true }),
      "roulette audit",
    );
    return {
      items: page.items.map(({ subject, ...entry }) => ({
        ...entry,
        ...auditTargetOf(subject),
        data: {},
      })),
      nextCursor: page.nextCursor,
    };
  }
}
