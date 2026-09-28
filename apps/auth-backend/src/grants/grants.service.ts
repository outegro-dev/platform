import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  billingGrantChanged,
  defineQueue,
  type EventOf,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { AuthDatabase } from "../common/database.js";
import { grants } from "../db/schema.js";

export const grantsQueue = defineQueue("identity", "billing-grants", [
  { producer: "payments", types: [billingGrantChanged.type] },
]);

/**
 * Projection of commercial grants. Payments owns them; Identity only
 * answers "does this user have feature X of service Y right now".
 */
@Injectable()
export class GrantsService implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(grantsQueue, async (event) => {
      const parsed = billingGrantChanged.schema.safeParse(event);
      if (!parsed.success)
        throw new PermanentError("invalid billing.grant.changed payload");
      await this.apply(parsed.data);
    });
  }

  /** Newer versions win; a stale event never resurrects a revoked grant (INV-11). */
  async apply(event: EventOf<typeof billingGrantChanged>) {
    const p = event.payload;
    const row = {
      grantId: p.grantId,
      userId: p.userId,
      service: p.service,
      feature: p.feature,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      state: p.state,
      validFrom: new Date(p.validFrom),
      validUntil: p.validUntil ? new Date(p.validUntil) : null,
      version: event.aggregateVersion,
      updatedAt: this.clock.now(),
    };
    await processOnce(
      this.database.db,
      {
        consumer: "identity.billing-grants",
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        await tx
          .insert(grants)
          .values(row)
          .onConflictDoUpdate({
            target: grants.grantId,
            set: row,
            setWhere: sql`${grants.version} < ${event.aggregateVersion}`,
          });
      },
    );
  }

  /** Grants in force at this moment; expiry needs no cron (INV-12). */
  async active(userId: string) {
    const now = this.clock.now();
    const rows = await this.database.db
      .select({
        grantId: grants.grantId,
        service: grants.service,
        feature: grants.feature,
        sourceType: grants.sourceType,
        validUntil: grants.validUntil,
      })
      .from(grants)
      .where(
        and(
          eq(grants.userId, userId),
          eq(grants.state, "active"),
          lte(grants.validFrom, now),
          or(isNull(grants.validUntil), gt(grants.validUntil, now)),
        ),
      );
    return rows.map((row) => ({
      ...row,
      validUntil: row.validUntil?.toISOString() ?? null,
    }));
  }
}
