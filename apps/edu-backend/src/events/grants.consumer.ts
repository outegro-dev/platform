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
import { eduService } from "@outegro/contracts/edu";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { sql } from "drizzle-orm";
import type { EduDatabase, EduTx } from "../common/database.js";
import { grants } from "../db/schema.js";
import { lockedAccountStatus } from "../readers/account-lock.js";

export const grantsQueue = defineQueue("edu", "billing-grants", [
  { producer: "payments", types: [billingGrantChanged.type] },
]);

/**
 * Projection of the books' commercial grants. Payments owns them; here they
 * only answer "may this reader open a paid chapter now", checked at the
 * moment of reading, so expiry needs no event.
 */
@Injectable()
export class GrantsConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
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

  /**
   * Idempotent and newer-wins: a redelivered event is a no-op and an older
   * version never resurrects a revoked grant (INV-11). True when it changed
   * the projection.
   */
  async apply(event: EventOf<typeof billingGrantChanged>): Promise<boolean> {
    const p = event.payload;
    if (p.service !== eduService) return false;
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
        // A deleted account's data is gone; a late grant must not bring it
        // back, nor one that arrives while the account is being purged.
        // (A suspended account keeps its grants up to date.)
        const status = await lockedAccountStatus(tx as EduTx, p.userId);
        if (status === "deleted") return;
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
    return changed;
  }
}
