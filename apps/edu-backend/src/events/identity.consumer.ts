import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import {
  type AnyEvent,
  defineQueue,
  identityRoleBindingChanged,
  identityUserStatusChanged,
  type userStatusSchema,
} from "@outegro/contracts";
import { processOnce } from "@outegro/db";
import {
  CLOCK,
  type Clock,
  DATABASE,
  Messaging,
  PermanentError,
} from "@outegro/nest-common";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { EduDatabase, EduTx } from "../common/database.js";
import {
  assistUsage,
  cardStatesTable,
  exerciseResults,
  grants,
  readerDays,
  readerProgress,
  understandingChecks,
  users,
} from "../db/schema.js";
import { lockAccountForChange } from "../readers/account-lock.js";

export const identityQueue = defineQueue("edu", "identity-events", [
  {
    producer: "identity",
    types: [identityUserStatusChanged.type, identityRoleBindingChanged.type],
  },
]);

type Change = {
  userId: string;
  accessVersion: number;
  /** Only status events carry one; role changes say nothing about it. */
  status?: z.infer<typeof userStatusSchema>;
};

/**
 * Accounts from Identity. Status and role changes both bump accessVersion,
 * which admin commands compare with the token's `av`; a status applies only
 * if it is newer than the stored one, so events delivered late or again
 * change nothing (a role change never holds a status back). A deleted
 * account loses its reading data here: progress, answers, cards, days,
 * understanding scores, assistant usage and grants (data minimisation).
 * Every change holds the reader's account lock (account-lock.ts), so no
 * write of the reader runs across it and none lands after the purge.
 */
@Injectable()
export class IdentityConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: EduDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messaging: Messaging,
  ) {}

  async onApplicationBootstrap() {
    await this.messaging.subscribe(identityQueue, async (event) => {
      await this.apply(event);
    });
  }

  /** True when the event changed the stored account. */
  async apply(event: AnyEvent): Promise<boolean> {
    const change = this.changeOf(event);
    let changed = false;
    await processOnce(
      this.database.db,
      {
        consumer: identityQueue.name,
        eventId: event.eventId,
        type: event.type,
      },
      async (tx) => {
        const now = this.clock.now();
        // The reader's writes in flight finish first and new ones wait: a
        // purge then takes everything, and a write after it sees the status.
        await lockAccountForChange(tx as EduTx, change.userId);
        // The row exists before it is locked, so events of one account
        // apply one after another.
        await tx
          .insert(users)
          .values({ userId: change.userId, updatedAt: now })
          .onConflictDoNothing();
        const [stored] = await tx
          .select()
          .from(users)
          .where(eq(users.userId, change.userId))
          .for("update");
        if (!stored) return;
        const status =
          change.status !== undefined &&
          change.accessVersion > stored.statusVersion
            ? change.status
            : undefined;
        const newer = change.accessVersion > stored.accessVersion;
        if (status === undefined && !newer) return;
        await tx
          .update(users)
          .set({
            ...(status === undefined
              ? {}
              : { status, statusVersion: change.accessVersion }),
            ...(newer ? { accessVersion: change.accessVersion } : {}),
            updatedAt: now,
          })
          .where(eq(users.userId, change.userId));
        if (status === "deleted")
          // processOnce runs it in a transaction of this service's database.
          await this.forget(tx as EduTx, change.userId);
        changed = true;
      },
    );
    return changed;
  }

  private async forget(tx: EduTx, userId: string) {
    await tx.delete(exerciseResults).where(eq(exerciseResults.userId, userId));
    await tx.delete(cardStatesTable).where(eq(cardStatesTable.userId, userId));
    await tx.delete(readerProgress).where(eq(readerProgress.userId, userId));
    await tx.delete(readerDays).where(eq(readerDays.userId, userId));
    await tx
      .delete(understandingChecks)
      .where(eq(understandingChecks.userId, userId));
    await tx.delete(assistUsage).where(eq(assistUsage.userId, userId));
    await tx.delete(grants).where(eq(grants.userId, userId));
  }

  private changeOf(event: AnyEvent): Change {
    switch (event.type) {
      case identityUserStatusChanged.type: {
        const parsed = identityUserStatusChanged.schema.safeParse(event);
        if (!parsed.success)
          throw new PermanentError(
            "invalid identity.user.status.changed payload",
          );
        const { userId, status, accessVersion } = parsed.data.payload;
        return { userId, status, accessVersion };
      }
      case identityRoleBindingChanged.type: {
        const parsed = identityRoleBindingChanged.schema.safeParse(event);
        if (!parsed.success)
          throw new PermanentError(
            "invalid identity.role.binding.changed payload",
          );
        const { userId, accessVersion } = parsed.data.payload;
        return { userId, accessVersion };
      }
      default:
        throw new PermanentError(`unexpected event ${event.type}`);
    }
  }
}
