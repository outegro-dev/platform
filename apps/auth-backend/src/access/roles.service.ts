import { Inject, Injectable } from "@nestjs/common";
import {
  createEvent,
  identityRoleBindingChanged,
  type Permission,
  permissionsOf,
  platformRoles,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import { AppError, CLOCK, type Clock, DATABASE } from "@outegro/nest-common";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { audit } from "../common/audit.js";
import type { AuthDatabase, AuthDb, AuthTx } from "../common/database.js";
import { roleBindings, users } from "../db/schema.js";

export type Actor = { userId: string | null; requestId?: string | null };

const notExpired = (now: Date) =>
  or(isNull(roleBindings.expiresAt), gt(roleBindings.expiresAt, now));

@Injectable()
export class RolesService {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Active, unexpired platform roles; what goes into access tokens. */
  async activeRoles(userId: string, db: AuthDb | AuthTx = this.database.db) {
    const rows = await db
      .select({ role: roleBindings.role })
      .from(roleBindings)
      .where(
        and(
          eq(roleBindings.userId, userId),
          eq(roleBindings.state, "active"),
          notExpired(this.clock.now()),
        ),
      );
    return [...new Set(rows.map((row) => row.role))].sort();
  }

  /**
   * Permissions read fresh from the database. Admin commands use this
   * instead of the token's `roles` claim, so a revoked or expired binding
   * stops working immediately rather than when the token expires.
   */
  async freshPermissions(userId: string): Promise<Set<Permission>> {
    const [user] = await this.database.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.status !== "active") return new Set();
    return permissionsOf(await this.activeRoles(userId));
  }

  async grant(
    actor: Actor,
    input: {
      userId: string;
      role: string;
      reason: string;
      expiresAt?: Date | null;
    },
    tx?: AuthTx,
  ) {
    // Own keys only: `in` also finds constructor, toString and the like.
    if (!Object.hasOwn(platformRoles, input.role)) {
      throw new AppError("VALIDATION_FAILED", {
        fieldErrors: { role: ["unknown role"] },
      });
    }
    const run = async (t: AuthTx) => {
      const now = this.clock.now();
      const [user] = await t
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId));
      if (!user) throw new AppError("NOT_FOUND");
      const [binding] = await t
        .insert(roleBindings)
        .values({
          userId: input.userId,
          role: input.role,
          reason: input.reason,
          expiresAt: input.expiresAt ?? null,
          grantedBy: actor.userId,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!binding)
        throw new AppError("CONFLICT", { message: "role already active" });
      const accessVersion = await this.bumpAccessVersion(t, input.userId, now);
      await audit(t, {
        actorId: actor.userId,
        action: "role.granted",
        targetType: "user",
        targetId: input.userId,
        reason: input.reason,
        data: {
          bindingId: binding.id,
          role: input.role,
          expiresAt: input.expiresAt ?? null,
        },
        requestId: actor.requestId,
        at: now,
      });
      await enqueueEvent(
        t,
        createEvent(identityRoleBindingChanged, {
          aggregateId: binding.id,
          aggregateVersion: 1,
          occurredAt: now,
          payload: {
            bindingId: binding.id,
            userId: input.userId,
            roleKey: input.role,
            scope: binding.scope,
            state: "active",
            accessVersion,
          },
        }),
      );
      return binding;
    };
    return tx ? run(tx) : this.database.db.transaction(run);
  }

  async revoke(actor: Actor, input: { bindingId: string; reason: string }) {
    return this.database.db.transaction(async (tx) => {
      const now = this.clock.now();
      const [binding] = await tx
        .select()
        .from(roleBindings)
        .where(eq(roleBindings.id, input.bindingId))
        .for("update");
      if (binding?.state !== "active") throw new AppError("NOT_FOUND");
      if (binding.role === "owner")
        await this.assertNotLastOwner(tx, binding.userId);
      await tx
        .update(roleBindings)
        .set({ state: "revoked", revokedAt: now, revokedBy: actor.userId })
        .where(eq(roleBindings.id, binding.id));
      const accessVersion = await this.bumpAccessVersion(
        tx,
        binding.userId,
        now,
      );
      await audit(tx, {
        actorId: actor.userId,
        action: "role.revoked",
        targetType: "user",
        targetId: binding.userId,
        reason: input.reason,
        data: { bindingId: binding.id, role: binding.role },
        requestId: actor.requestId,
        at: now,
      });
      await enqueueEvent(
        tx,
        createEvent(identityRoleBindingChanged, {
          aggregateId: binding.id,
          aggregateVersion: 2,
          occurredAt: now,
          payload: {
            bindingId: binding.id,
            userId: binding.userId,
            roleKey: binding.role,
            scope: binding.scope,
            state: "revoked",
            accessVersion,
          },
        }),
      );
    });
  }

  /**
   * Locks every active owner binding (and their users) before counting, so
   * two owners removing each other concurrently cannot both succeed (INV-09).
   * Call inside the transaction that would remove `userId` as an owner.
   */
  async assertNotLastOwner(tx: AuthTx, userId: string) {
    const owners = await tx
      .select({ userId: roleBindings.userId, status: users.status })
      .from(roleBindings)
      .innerJoin(users, eq(users.id, roleBindings.userId))
      .where(
        and(
          eq(roleBindings.role, "owner"),
          eq(roleBindings.state, "active"),
          notExpired(this.clock.now()),
        ),
      )
      .for("update");
    const others = owners.filter(
      (owner) => owner.userId !== userId && owner.status === "active",
    );
    if (
      owners.some((owner) => owner.userId === userId) &&
      others.length === 0
    ) {
      throw new AppError("UNPROCESSABLE", { message: "last owner" });
    }
  }

  private async bumpAccessVersion(tx: AuthTx, userId: string, now: Date) {
    const [row] = await tx
      .update(users)
      .set({ accessVersion: sql`${users.accessVersion} + 1`, updatedAt: now })
      .where(eq(users.id, userId))
      .returning({ accessVersion: users.accessVersion });
    return row?.accessVersion ?? 0;
  }
}
