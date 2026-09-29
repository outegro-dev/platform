import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  billingGrantChanged,
  defineQueue,
  type EventOf,
} from "@outegro/contracts";
import { battleshipService } from "@outegro/contracts/battleship";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { sql } from "drizzle-orm";
import type { BattleshipDatabase } from "../common/database.js";
import { grants } from "../db/schema.js";
import { EntitlementWatch } from "../players/entitlement.watch.js";
import { PlayersService } from "../players/players.service.js";

export const grantsQueue = defineQueue("battleship", "billing-grants", [
  { producer: "payments", types: [billingGrantChanged.type] },
]);

/**
 * Projection of the game's commercial grants. Payments owns them; here they
 * only answer "may this player use feature X now". A change reaches the
 * player's open sockets at once (TC-BS-09).
 */
@Injectable()
export class GrantsConsumer implements OnApplicationBootstrap {
  private readonly logger = new Logger("GrantsConsumer");

  constructor(
    @Inject(DATABASE) private readonly database: BattleshipDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
    private readonly players: PlayersService,
    private readonly watch: EntitlementWatch,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(grantsQueue, async (event) => {
      const parsed = billingGrantChanged.schema.safeParse(event);
      if (!parsed.success)
        throw new PermanentError("invalid billing.grant.changed payload");
      await this.apply(parsed.data);
    });
  }

  /**
   * Idempotent and newer-wins: a redelivered event is a no-op and an older
   * version never resurrects a revoked grant (INV-11). True when it changed
   * the projection.
   */
  async apply(event: EventOf<typeof billingGrantChanged>): Promise<boolean> {
    const p = event.payload;
    if (p.service !== battleshipService) return false;
    const row = {
      grantId: p.grantId,
      userId: p.userId,
      feature: p.feature,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      state: p.state,
      validFrom: new Date(p.validFrom),
      validUntil: p.validUntil ? new Date(p.validUntil) : null,
      version: event.aggregateVersion,
      updatedAt: this.clock.now(),
    };
    let changed = false;
    await processOnce(
      this.database.db,
      {
        consumer: grantsQueue.name,
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        const rows = await tx
          .insert(grants)
          .values(row)
          .onConflictDoUpdate({
            target: grants.grantId,
            set: row,
            setWhere: sql`${grants.version} < ${event.aggregateVersion}`,
          })
          .returning({ grantId: grants.grantId });
        changed = rows.length > 0;
      },
    );
    if (changed) {
      // Delivery is best effort: the projection is already committed.
      try {
        await this.players.pushUpdate(p.userId);
        await this.watch.watch(p.userId);
      } catch (error) {
        this.logger.warn(
          { err: (error as Error).message },
          "player.updated failed",
        );
      }
    }
    return changed;
  }
}
