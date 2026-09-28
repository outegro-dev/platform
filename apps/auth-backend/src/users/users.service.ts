import { Inject, Injectable } from "@nestjs/common";
import {
  createEvent,
  identityUserContactChanged,
  identityUserCreated,
  identityUserLocaleChanged,
  identityUserStatusChanged,
  type Locale,
} from "@outegro/contracts";
import { enqueueEvent } from "@outegro/db";
import {
  AppError,
  CLOCK,
  type Clock,
  DATABASE,
  OutboxRelay,
} from "@outegro/nest-common";
import { and, eq, sql } from "drizzle-orm";
import type { Actor } from "../access/roles.service.js";
import { RolesService } from "../access/roles.service.js";
import { audit } from "../common/audit.js";
import type { AuthDatabase, AuthTx } from "../common/database.js";
import { users } from "../db/schema.js";
import { SessionsService } from "../sessions/sessions.service.js";

type User = typeof users.$inferSelect;

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly database: AuthDatabase,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly roles: RolesService,
    private readonly sessions: SessionsService,
    private readonly relay: OutboxRelay,
  ) {}

  toProfile(user: User) {
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      locale: user.locale,
      status: user.status,
      version: user.version,
      createdAt: user.createdAt.toISOString(),
    };
  }

  /** Called after a correct login code: the email is now proven. */
  async findOrCreateVerified(tx: AuthTx, email: string, locale: Locale) {
    const now = this.clock.now();
    const [created] = await tx
      .insert(users)
      .values({
        email,
        emailVerified: true,
        locale,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (created) {
      await enqueueEvent(
        tx,
        createEvent(identityUserCreated, {
          aggregateId: created.id,
          aggregateVersion: created.version,
          occurredAt: now,
          payload: {
            userId: created.id,
            locale: created.locale,
            status: created.status,
          },
        }),
      );
      await this.contactChanged(tx, created, now);
      return created;
    }
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, email))
      .for("update");
    if (!existing) throw new Error("user vanished");
    if (!existing.emailVerified) {
      const [verified] = await tx
        .update(users)
        .set({
          emailVerified: true,
          version: sql`${users.version} + 1`,
          updatedAt: now,
        })
        .where(eq(users.id, existing.id))
        .returning();
      if (verified) {
        await this.contactChanged(tx, verified, now);
        return verified;
      }
    }
    return existing;
  }

  async get(userId: string) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    if (!user) throw new AppError("NOT_FOUND");
    return user;
  }

  /** Profile edit with optimistic concurrency (HTTP contract: expectedVersion). */
  async update(
    userId: string,
    input: {
      expectedVersion: number;
      displayName?: string | null;
      locale?: Locale;
    },
  ) {
    const now = this.clock.now();
    const updated = await this.database.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .for("update");
      if (!before) throw new AppError("NOT_FOUND");
      if (before.version !== input.expectedVersion) {
        throw new AppError("VERSION_CONFLICT", {
          fieldErrors: { version: [String(before.version)] },
        });
      }
      const [after] = await tx
        .update(users)
        .set({
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          ...(input.locale ? { locale: input.locale } : {}),
          version: sql`${users.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(eq(users.id, userId), eq(users.version, input.expectedVersion)),
        )
        .returning();
      if (!after) throw new AppError("VERSION_CONFLICT");
      if (input.locale && input.locale !== before.locale) {
        await enqueueEvent(
          tx,
          createEvent(identityUserLocaleChanged, {
            aggregateId: after.id,
            aggregateVersion: after.version,
            occurredAt: now,
            payload: { userId: after.id, locale: after.locale },
          }),
        );
      }
      return after;
    });
    this.relay.kick();
    return this.toProfile(updated);
  }

  /** Suspend or reactivate; the last owner cannot be suspended. */
  async setStatus(
    actor: Actor,
    userId: string,
    status: "active" | "suspended",
    reason: string,
  ) {
    const now = this.clock.now();
    const user = await this.database.db.transaction(async (tx) => {
      if (status === "suspended")
        await this.roles.assertNotLastOwner(tx, userId);
      const [row] = await tx
        .update(users)
        .set({
          status,
          accessVersion: sql`${users.accessVersion} + 1`,
          version: sql`${users.version} + 1`,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning();
      if (!row) throw new AppError("NOT_FOUND");
      await audit(tx, {
        actorId: actor.userId,
        action: `user.${status}`,
        targetType: "user",
        targetId: userId,
        reason,
        requestId: actor.requestId,
        at: now,
      });
      await enqueueEvent(
        tx,
        createEvent(identityUserStatusChanged, {
          aggregateId: row.id,
          aggregateVersion: row.version,
          occurredAt: now,
          payload: {
            userId: row.id,
            status: row.status,
            accessVersion: row.accessVersion,
          },
        }),
      );
      return row;
    });
    // A suspended account keeps no live session anywhere (TC-ID-10-04).
    if (status === "suspended") {
      await this.sessions.revoke(userId, "all", "admin", {
        userId: actor.userId,
      });
    }
    this.relay.kick();
    return this.toProfile(user);
  }

  private contactChanged(tx: AuthTx, user: User, now: Date) {
    return enqueueEvent(
      tx,
      createEvent(identityUserContactChanged, {
        aggregateId: user.id,
        aggregateVersion: user.version,
        occurredAt: now,
        payload: {
          userId: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
      }),
    );
  }
}
