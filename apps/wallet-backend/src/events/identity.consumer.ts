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
import { and, eq, isNotNull, like, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { WalletDatabase, WalletTx } from "../common/database.js";
import { users, wallets } from "../db/schema.js";

export const identityQueue = defineQueue("wallet", "identity-events", [
  {
    producer: "identity",
    types: [identityUserStatusChanged.type, identityRoleBindingChanged.type],
  },
]);

type Status = z.infer<typeof userStatusSchema>;
type Change = {
  userId: string;
  accessVersion: number;
  /** Only status events carry one; role changes say nothing about it. */
  status?: Status;
};

/**
 * Accounts from Identity. A suspended or deleted account restricts its
 * wallets (no debits through the internal API); back to active lifts only
 * that restriction. Balances and the journal stay, deleted or not. Status
 * and role changes both bump accessVersion, which admin commands compare
 * with the token's `av`; a status applies only if newer than the stored
 * one, so events delivered late or again change nothing.
 */
@Injectable()
export class IdentityConsumer implements OnApplicationBootstrap {
  constructor(
    @Inject(DATABASE) private readonly database: WalletDatabase,
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
      async (anyTx) => {
        // processOnce runs it in a transaction of this service's database.
        const tx = anyTx as WalletTx;
        const now = this.clock.now();
        // The row exists before it is locked, so events of one account
        // apply one after another, and a wallet being created waits.
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
        if (status !== undefined)
          await this.restrict(tx, change.userId, status, now);
        changed = true;
      },
    );
    return changed;
  }

  private async restrict(
    tx: WalletTx,
    userId: string,
    status: Status,
    now: Date,
  ) {
    if (status === "active") {
      // A debt (phase 2) outlives the account's restriction.
      await tx
        .update(wallets)
        .set({
          state: sql`case when ${wallets.debt} > 0 then 'restricted' else 'active' end`,
          restrictedReason: sql`case when ${wallets.debt} > 0 then 'debt' end`,
          updatedAt: now,
        })
        .where(
          and(
            eq(wallets.userId, userId),
            like(wallets.restrictedReason, "account_%"),
          ),
        );
      return;
    }
    // Any other restriction (a debt, later) keeps its own reason.
    await tx
      .update(wallets)
      .set({
        state: "restricted",
        restrictedReason: `account_${status}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(wallets.userId, userId),
          or(
            eq(wallets.state, "active"),
            and(
              isNotNull(wallets.restrictedReason),
              like(wallets.restrictedReason, "account_%"),
            ),
          ),
        ),
      );
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
